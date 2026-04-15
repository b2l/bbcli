import {
	getPullRequest,
	type PullRequestDetail,
	PullRequestError,
	type ReviewState,
} from "../../backend/pullrequests/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import {
	RepositoryResolutionError,
	resolveRepository,
} from "../../shared/repository/index.ts";
import { formatRelativeTime } from "../../shared/time/index.ts";
import { resolveCurrentPullRequestId } from "./current.ts";

export type PullRequestViewOptions = {
	repository?: string;
};

const REVIEW_GLYPH: Record<ReviewState, string> = {
	approved: "✓",
	changes_requested: "✗",
	pending: "…",
};

const REVIEW_LABEL: Record<ReviewState, string> = {
	approved: "approved",
	changes_requested: "changes requested",
	pending: "pending",
};

export async function runPullRequestView(
	renderer: Renderer,
	idArg: string | undefined,
	options: PullRequestViewOptions,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	try {
		const ref = await resolveRepository({ override: options.repository });
		const id = await resolveCurrentPullRequestId(idArg, {
			renderer,
			config,
			ref,
			commandName: "view",
		});

		const pr = await getPullRequest(config, ref, id);
		render(renderer, pr);
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

function render(renderer: Renderer, pr: PullRequestDetail): void {
	renderer.detail(pr, [
		{ label: "#", value: (p) => String(p.id) },
		{ label: "TITLE", value: (p) => p.title, style: "bold" },
		{ label: "STATE", value: (p) => p.state },
		{
			label: "AUTHOR",
			value: (p) => p.author?.displayName ?? p.author?.nickname ?? "(unknown)",
			style: "muted",
		},
		{
			label: "BRANCH",
			value: (p) => `${p.sourceBranch} → ${p.destinationBranch}`,
		},
		{
			label: "CREATED",
			value: (p) => formatRelativeTime(p.createdOn),
			style: "muted",
		},
		{
			label: "UPDATED",
			value: (p) => formatRelativeTime(p.updatedOn),
			style: "muted",
		},
		{ label: "URL", value: (p) => p.url, style: "muted" },
	]);

	renderer.message("");
	renderer.message("DESCRIPTION");
	renderer.message(pr.description.trim() || "(no description)");

	renderer.message("");
	renderer.message("REVIEWERS");
	if (pr.reviewers.length === 0) {
		renderer.message("  (none)");
		return;
	}
	for (const r of pr.reviewers) {
		const name = r.account.displayName || r.account.nickname;
		renderer.message(
			`  ${REVIEW_GLYPH[r.state]} ${name} (${REVIEW_LABEL[r.state]})`,
		);
	}
}
