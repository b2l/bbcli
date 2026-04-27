import {
	listPipelines,
	PipelineError,
	VALID_STATUS_FILTERS,
} from "../../backend/pipelines/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import {
	RepositoryResolutionError,
	resolveRepository,
} from "../../shared/repository/index.ts";
import { formatRelativeTime } from "../../shared/time/index.ts";

export type PipelineListOptions = {
	repository?: string;
	branch?: string;
	status?: string;
	limit?: string;
};

const DEFAULT_LIMIT = 30;

export async function runPipelineList(
	renderer: Renderer,
	options: PipelineListOptions,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	const limit = parseLimit(options.limit);
	if (limit === null) {
		renderer.error(
			`Invalid --limit '${options.limit}'. Expected a positive integer.`,
		);
		process.exit(1);
	}

	if (options.status && !VALID_STATUS_FILTERS.includes(options.status)) {
		renderer.error(
			`Invalid --status '${options.status}'. Expected one of: ${VALID_STATUS_FILTERS.join(", ")}.`,
		);
		process.exit(1);
	}

	try {
		const ref = await resolveRepository({ override: options.repository });

		const pipelines = await listPipelines(config, ref, {
			limit,
			branch: options.branch,
			status: options.status,
		});

		if (pipelines.length === 0) {
			renderer.message("No pipeline runs found.");
			return;
		}

		renderer.list(pipelines, [
			{ header: "#", value: (p) => String(p.buildNumber) },
			{ header: "STATUS", value: (p) => p.status },
			{ header: "BRANCH", value: (p) => p.branch, flex: true },
			{ header: "COMMIT", value: (p) => p.commitHash, style: "muted" },
			{ header: "TRIGGER", value: (p) => p.trigger, style: "muted" },
			{
				header: "DURATION",
				value: (p) => formatDuration(p.durationSeconds),
				style: "muted",
			},
			{ header: "CREATOR", value: (p) => p.creator, style: "muted" },
			{
				header: "CREATED",
				value: (p) => formatRelativeTime(p.createdOn),
				style: "muted",
			},
		]);
	} catch (err) {
		if (
			err instanceof RepositoryResolutionError ||
			err instanceof PipelineError
		) {
			renderer.error(err.message);
			process.exit(1);
		}
		throw err;
	}
}

function parseLimit(raw: string | undefined): number | null {
	if (raw === undefined) return DEFAULT_LIMIT;
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) return null;
	return n;
}

function formatDuration(seconds: number | null): string {
	if (seconds === null) return "-";
	if (seconds < 60) return `${seconds}s`;
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	if (s === 0) return `${m}m`;
	return `${m}m${s}s`;
}
