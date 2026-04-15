import {
	listPullRequests,
	PullRequestError,
	type PullRequestStateFilter,
	type UserFilter,
} from "../../backend/pullrequests/index.ts";
import { getCurrentUser, UserError } from "../../backend/user/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import {
	RepositoryResolutionError,
	resolveRepository,
} from "../../shared/repository/index.ts";
import { formatRelativeTime } from "../../shared/time/index.ts";

export type PullRequestListOptions = {
	repository?: string;
	state?: string;
	author?: string;
	reviewer?: string;
	limit?: string;
};

const VALID_STATES: readonly PullRequestStateFilter[] = [
	"open",
	"merged",
	"declined",
	"all",
] as const;

const DEFAULT_LIMIT = 30;

export async function runPullRequestList(
	renderer: Renderer,
	options: PullRequestListOptions,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	const state = parseState(options.state);
	if (!state) {
		renderer.error(
			`Invalid --state '${options.state}'. Expected one of: ${VALID_STATES.join(", ")}.`,
		);
		process.exit(1);
	}

	const limit = parseLimit(options.limit);
	if (limit === null) {
		renderer.error(
			`Invalid --limit '${options.limit}'. Expected a positive integer.`,
		);
		process.exit(1);
	}

	const author = parseUserFilter(options.author);
	const reviewer = parseUserFilter(options.reviewer);
	const needsMe = author?.kind === "me" || reviewer?.kind === "me";

	try {
		const ref = await resolveRepository({ override: options.repository });

		let currentUserUuid: string | undefined;
		if (needsMe) {
			const me = await getCurrentUser(config);
			currentUserUuid = me.uuid;
		}

		const prs = await listPullRequests(config, ref, {
			state,
			author,
			reviewer,
			limit,
			currentUserUuid,
		});

		if (prs.length === 0) {
			renderer.message("No pull requests found.");
			return;
		}

		renderer.list(prs, [
			{ header: "#", value: (pr) => String(pr.id) },
			{ header: "TITLE", value: (pr) => pr.title, flex: true },
			{
				header: "AUTHOR",
				value: (pr) => pr.author?.displayName ?? pr.author?.nickname ?? "",
				style: "muted",
			},
			{ header: "STATE", value: (pr) => pr.state },
			{
				header: "UPDATED",
				value: (pr) => formatRelativeTime(pr.updatedOn),
				style: "muted",
			},
		]);
	} catch (err) {
		if (
			err instanceof RepositoryResolutionError ||
			err instanceof PullRequestError ||
			err instanceof UserError
		) {
			renderer.error(err.message);
			process.exit(1);
		}
		throw err;
	}
}

function parseState(raw: string | undefined): PullRequestStateFilter | null {
	const value = (raw ?? "open").toLowerCase();
	return (VALID_STATES as readonly string[]).includes(value)
		? (value as PullRequestStateFilter)
		: null;
}

function parseLimit(raw: string | undefined): number | null {
	if (raw === undefined) return DEFAULT_LIMIT;
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) return null;
	return n;
}

function parseUserFilter(raw: string | undefined): UserFilter | undefined {
	if (!raw) return undefined;
	if (raw === "@me") return { kind: "me" };
	return { kind: "nickname", value: raw };
}
