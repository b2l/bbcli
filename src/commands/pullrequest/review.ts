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
};

type ReviewAction = (
	config: Awaited<ReturnType<typeof loadConfigOrExit>>,
	ref: { workspace: string; slug: string },
	id: number,
) => Promise<void>;

async function runReviewAction(
	renderer: Renderer,
	idArg: string | undefined,
	options: PullRequestReviewOptions,
	action: ReviewAction,
	commandName: string,
	successMessage: (id: number) => string,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	try {
		const ref = await resolveRepository({ override: options.repository });
		const id = await resolveCurrentPullRequestId(idArg, {
			renderer,
			config,
			ref,
			commandName,
		});

		await action(config, ref, id);
		renderer.message(successMessage(id));
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

export function runPullRequestApprove(
	renderer: Renderer,
	idArg: string | undefined,
	options: PullRequestReviewOptions,
): Promise<void> {
	return runReviewAction(
		renderer,
		idArg,
		options,
		approvePullRequest,
		"approve",
		(id) => `Approved pull request #${id}.`,
	);
}

export function runPullRequestUnapprove(
	renderer: Renderer,
	idArg: string | undefined,
	options: PullRequestReviewOptions,
): Promise<void> {
	return runReviewAction(
		renderer,
		idArg,
		options,
		unapprovePullRequest,
		"unapprove",
		(id) => `Withdrew approval on pull request #${id}.`,
	);
}

export function runPullRequestRequestChanges(
	renderer: Renderer,
	idArg: string | undefined,
	options: PullRequestReviewOptions,
): Promise<void> {
	return runReviewAction(
		renderer,
		idArg,
		options,
		requestChangesOnPullRequest,
		"request-changes",
		(id) => `Requested changes on pull request #${id}.`,
	);
}

export function runPullRequestUnrequestChanges(
	renderer: Renderer,
	idArg: string | undefined,
	options: PullRequestReviewOptions,
): Promise<void> {
	return runReviewAction(
		renderer,
		idArg,
		options,
		withdrawRequestChanges,
		"unrequest-changes",
		(id) => `Withdrew request-for-changes on pull request #${id}.`,
	);
}
