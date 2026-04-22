import {
	declinePullRequest,
	getPullRequest,
	PullRequestError,
	type PullRequestState,
} from "../../backend/pullrequests/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import {
	RepositoryResolutionError,
	resolveRepository,
} from "../../shared/repository/index.ts";
import { resolveCurrentPullRequestId } from "./current.ts";

export type PullRequestDeclineOptions = {
	repository?: string;
};

const TERMINAL_STATES: ReadonlySet<PullRequestState> = new Set([
	"MERGED",
	"DECLINED",
	"SUPERSEDED",
]);

/**
 * Declines an open PR. Pre-flights with a GET so we can refuse cleanly on
 * already-terminal states (merged / declined / superseded) without relying
 * on Bitbucket's error body shape. The extra request is cheap vs. the
 * alternative of parsing 4xx bodies to tell them apart.
 */
export async function runPullRequestDecline(
	renderer: Renderer,
	idArg: string | undefined,
	options: PullRequestDeclineOptions,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	try {
		const ref = await resolveRepository({ override: options.repository });
		const id = await resolveCurrentPullRequestId(idArg, {
			renderer,
			config,
			ref,
			commandName: "decline",
		});

		const current = await getPullRequest(config, ref, id);
		if (TERMINAL_STATES.has(current.state)) {
			renderer.error(
				`Pull request #${id} is ${current.state.toLowerCase()}; cannot decline.`,
			);
			process.exit(1);
		}

		const updated = await declinePullRequest(config, ref, id);

		if (renderer.json) {
			renderer.detail(updated, []);
			return;
		}
		renderer.message(`Declined pull request #${id}: ${updated.url}`);
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
