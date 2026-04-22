import {
	getPullRequest,
	PullRequestError,
	type PullRequestState,
	updatePullRequest,
} from "../../backend/pullrequests/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import {
	RepositoryResolutionError,
	resolveRepository,
} from "../../shared/repository/index.ts";
import { resolveCurrentPullRequestId } from "./current.ts";

export type PullRequestReadyOptions = {
	repository?: string;
};

const IMMUTABLE_STATES: ReadonlySet<PullRequestState> = new Set([
	"MERGED",
	"DECLINED",
	"SUPERSEDED",
]);

/**
 * Marks a draft PR as ready for review via `PUT /pullrequests/{id}` with
 * `{draft: false}`. Idempotent at the command level: pre-flights with a
 * GET and short-circuits when the PR is already ready, so we don't rely
 * on the API tolerating `{draft: false}` on an already-ready PR (the
 * spec is silent on that case).
 *
 * Reverse (ready → draft) isn't supported by Bitbucket Cloud — the API
 * has no path for it — so no `--undraft` counterpart.
 */
export async function runPullRequestReady(
	renderer: Renderer,
	idArg: string | undefined,
	options: PullRequestReadyOptions,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	try {
		const ref = await resolveRepository({ override: options.repository });
		const id = await resolveCurrentPullRequestId(idArg, {
			renderer,
			config,
			ref,
			commandName: "ready",
		});

		const current = await getPullRequest(config, ref, id);
		if (IMMUTABLE_STATES.has(current.state)) {
			renderer.error(
				`Pull request #${id} is ${current.state.toLowerCase()}; cannot mark as ready.`,
			);
			process.exit(1);
		}

		if (!current.draft) {
			if (renderer.json) {
				renderer.detail(current, []);
				return;
			}
			renderer.message(`Pull request #${id} is already ready: ${current.url}`);
			return;
		}

		const updated = await updatePullRequest(config, ref, id, { draft: false });

		if (renderer.json) {
			renderer.detail(updated, []);
		} else {
			renderer.message(
				`Marked pull request #${id} as ready for review: ${updated.url}`,
			);
		}
	} catch (err) {
		if (
			err instanceof RepositoryResolutionError ||
			err instanceof PullRequestError
		) {
			renderer.error(err.message);
			process.exit(1);
		}
		throw err;
	}
}
