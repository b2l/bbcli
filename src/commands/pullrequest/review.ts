import {
	approvePullRequest,
	PullRequestError,
	requestChangesOnPullRequest,
	unapprovePullRequest,
	withdrawRequestChanges,
} from "../../backend/pullrequests/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import {
	RepositoryResolutionError,
	resolveRepository,
} from "../../shared/repository/index.ts";
import { resolveCurrentPullRequestId } from "./current.ts";

export type PullRequestReviewOptions = {
	repository?: string;
	approve?: boolean;
	requestChanges?: boolean;
	withdraw?: boolean;
};

/**
 * Submits a review on a PR. Bitbucket's API exposes approve/request-changes
 * as two independent mutable states; we hide that behind a single "current
 * review state" mental model (approved / changes-requested / nil). Setting
 * one state implicitly clears the other; --withdraw clears both.
 */
export async function runPullRequestReview(
	renderer: Renderer,
	idArg: string | undefined,
	options: PullRequestReviewOptions,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	const selected = [
		options.approve ? "--approve" : null,
		options.requestChanges ? "--request-changes" : null,
		options.withdraw ? "--withdraw" : null,
	].filter((v): v is string => v !== null);

	if (selected.length === 0) {
		renderer.error(
			"Specify one of --approve (-a), --request-changes (-r), or --withdraw (-w).",
		);
		process.exit(1);
	}
	if (selected.length > 1) {
		renderer.error(
			`--approve, --request-changes, and --withdraw are mutually exclusive; got ${selected.join(", ")}.`,
		);
		process.exit(1);
	}

	try {
		const ref = await resolveRepository({ override: options.repository });
		const id = await resolveCurrentPullRequestId(idArg, {
			renderer,
			config,
			ref,
			commandName: "review",
		});

		if (options.approve) {
			await approvePullRequest(config, ref, id);
			// If the reviewer previously requested changes, drop that so their
			// state is singular. Best-effort — the approve is what matters.
			await swallow(() => withdrawRequestChanges(config, ref, id));
			renderer.message(`Approved pull request #${id}.`);
			return;
		}

		if (options.requestChanges) {
			await requestChangesOnPullRequest(config, ref, id);
			await swallow(() => unapprovePullRequest(config, ref, id));
			renderer.message(`Requested changes on pull request #${id}.`);
			return;
		}

		// --withdraw: clear whichever state is set. Both best-effort since we
		// don't know the current state without an extra fetch; a DELETE on a
		// state we're not in is harmless (Bitbucket noops or 4xx's — we
		// swallow either way).
		await Promise.all([
			swallow(() => unapprovePullRequest(config, ref, id)),
			swallow(() => withdrawRequestChanges(config, ref, id)),
		]);
		renderer.message(`Withdrew review on pull request #${id}.`);
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

/**
 * Swallows PullRequestError so secondary cleanup calls don't mask the
 * primary action's success. Other errors propagate.
 */
async function swallow(fn: () => Promise<void>): Promise<void> {
	try {
		await fn();
	} catch (err) {
		if (err instanceof PullRequestError) return;
		throw err;
	}
}
