import {
	findOpenPullRequestForBranch,
	PullRequestError,
} from "../../backend/pullrequests/index.ts";
import type { Credentials } from "../../shared/bitbucket-http/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import { defaultGitRunner } from "../../shared/repository/index.ts";

export type CurrentPullRequestLookup = {
	renderer: Renderer;
	config: Credentials;
	ref: { workspace: string; slug: string };
	/** Command name to embed in error hints, e.g. "view", "comment". */
	commandName: string;
};

/**
 * Resolves the PR id for a command that accepts `[<id>]` and falls back to
 * "the open PR for the current branch" when omitted. Exits the process with
 * a clear error if neither can be determined.
 *
 * Extracted from `view.ts` so every command with this UX contract uses the
 * same detection, error messages, and hints.
 */
export async function resolveCurrentPullRequestId(
	idArg: string | undefined,
	lookup: CurrentPullRequestLookup,
): Promise<number> {
	if (idArg !== undefined) {
		const parsed = parseId(idArg);
		if (parsed === null) {
			lookup.renderer.error(
				`Invalid PR id '${idArg}'. Expected a positive integer.`,
			);
			process.exit(1);
		}
		return parsed;
	}

	const branch = await defaultGitRunner.getCurrentBranch(process.cwd());
	if (!branch) {
		lookup.renderer.error(
			`Could not determine the current branch (detached HEAD or not a git repo). Pass a PR number explicitly: bb pr ${lookup.commandName} <n>.`,
		);
		process.exit(1);
	}

	try {
		const summary = await findOpenPullRequestForBranch(
			lookup.config,
			lookup.ref,
			branch,
		);
		if (!summary) {
			lookup.renderer.error(
				`No open pull request for branch '${branch}'. Pass a PR number explicitly (bb pr ${lookup.commandName} <n>) or list available PRs (bb pr list).`,
			);
			process.exit(1);
		}
		return summary.id;
	} catch (err) {
		if (err instanceof PullRequestError) {
			lookup.renderer.error(err.message);
			process.exit(1);
		}
		throw err;
	}
}

function parseId(raw: string): number | null {
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) return null;
	return n;
}
