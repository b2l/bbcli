import {
	type Credentials,
	createBitbucketClient,
} from "../../shared/bitbucket-http/index.ts";
import {
	PaginationError,
	withPagination,
} from "../../shared/bitbucket-http/paginate.ts";

export type PipelineStatus =
	| "pending"
	| "running"
	| "paused"
	| "success"
	| "failed"
	| "stopped"
	| "error";

export type Pipeline = {
	buildNumber: number;
	status: PipelineStatus;
	branch: string;
	commitHash: string;
	trigger: string;
	creator: string;
	createdOn: string;
	durationSeconds: number | null;
};

export class PipelineError extends Error {
	readonly status: number | undefined;

	constructor(message: string, status?: number) {
		super(message);
		this.name = "PipelineError";
		this.status = status;
	}
}

/** User-friendly filter values mapped to the API's `status` query param. */
const STATUS_FILTER_MAP: Record<string, string> = {
	pending: "PENDING",
	running: "BUILDING",
	success: "PASSED",
	failed: "FAILED",
	stopped: "STOPPED",
	error: "ERROR",
};

export const VALID_STATUS_FILTERS = Object.keys(STATUS_FILTER_MAP);

export type ListPipelinesOptions = {
	limit: number;
	branch?: string;
	status?: string;
};

const PAGELEN = 50;

export async function listPipelines(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
	options: ListPipelinesOptions,
): Promise<Pipeline[]> {
	const client = createBitbucketClient(credentials);

	const query: Record<string, unknown> = {
		sort: "-created_on",
		pagelen: PAGELEN,
	};
	if (options.branch) {
		query["target.branch"] = options.branch;
	}
	if (options.status) {
		query.status = STATUS_FILTER_MAP[options.status] ?? options.status;
	}

	try {
		const raw = await withPagination(
			() =>
				client.GET("/repositories/{workspace}/{repo_slug}/pipelines", {
					params: {
						path: { workspace: ref.workspace, repo_slug: ref.slug },
						query,
					},
				}),
			credentials,
			{ limit: options.limit },
		);
		return raw.map(toPipeline);
	} catch (err) {
		if (err instanceof PaginationError) {
			throw new PipelineError(err.message, err.status);
		}
		throw err;
	}
}

function toPipeline(raw: Record<string, any>): Pipeline {
	const target = raw.target ?? {};
	const commit = target.commit ?? {};
	const hash = typeof commit.hash === "string" ? commit.hash : "";
	const creator = raw.creator ?? {};

	return {
		buildNumber: Number(raw.build_number ?? 0),
		status: extractStatus(raw.state),
		branch: String(target.ref_name ?? ""),
		commitHash: hash.slice(0, 12),
		trigger: extractTrigger(raw.trigger),
		creator:
			typeof creator.display_name === "string"
				? creator.display_name
				: typeof creator.nickname === "string"
					? creator.nickname
					: "",
		createdOn: String(raw.created_on ?? ""),
		durationSeconds: computeDuration(raw.created_on, raw.completed_on),
	};
}

function extractStatus(state: unknown): PipelineStatus {
	if (!state || typeof state !== "object") return "pending";
	const s = state as Record<string, any>;
	const name = String(s.name ?? "");

	if (name === "PENDING") return "pending";
	if (name === "IN_PROGRESS") {
		const stageName = s.stage?.name;
		if (stageName === "PAUSED") return "paused";
		return "running";
	}
	if (name === "COMPLETED") {
		const resultName = s.result?.name;
		if (resultName === "SUCCESSFUL") return "success";
		if (resultName === "FAILED") return "failed";
		if (resultName === "STOPPED") return "stopped";
		if (resultName === "ERROR") return "error";
	}
	return "pending";
}

function extractTrigger(trigger: unknown): string {
	if (!trigger || typeof trigger !== "object") return "";
	const t = trigger as Record<string, any>;
	const type = String(t.type ?? "");
	// The type field looks like "pipeline_trigger_push" — strip the prefix.
	if (type.startsWith("pipeline_trigger_")) {
		return type.slice("pipeline_trigger_".length);
	}
	return type;
}

function computeDuration(
	createdOn: unknown,
	completedOn: unknown,
): number | null {
	if (typeof createdOn !== "string" || typeof completedOn !== "string")
		return null;
	const start = new Date(createdOn).getTime();
	const end = new Date(completedOn).getTime();
	if (Number.isNaN(start) || Number.isNaN(end)) return null;
	return Math.round((end - start) / 1000);
}
