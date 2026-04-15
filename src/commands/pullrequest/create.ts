import {
	createPullRequest,
	listEffectiveDefaultReviewers,
	PullRequestError,
} from "../../backend/pullrequests/index.ts";
import { getCurrentUser, UserError } from "../../backend/user/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import {
	BodyInputError,
	resolveBodyInput,
} from "../../shared/editor/body-input.ts";
import { EditorError } from "../../shared/editor/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import {
	defaultGitRunner,
	RepositoryResolutionError,
	resolveRepository,
} from "../../shared/repository/index.ts";

export type PullRequestCreateOptions = {
	repository?: string;
	title?: string;
	body?: string;
	bodyFile?: string;
	base?: string;
	draft?: boolean;
};

export async function runPullRequestCreate(
	renderer: Renderer,
	options: PullRequestCreateOptions,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	if (!options.title) {
		renderer.error("--title is required.");
		process.exit(1);
	}
	if (options.body !== undefined && options.bodyFile !== undefined) {
		renderer.error("Pass either --body or --body-file, not both.");
		process.exit(1);
	}

	try {
		const ref = await resolveRepository({ override: options.repository });
		const cwd = process.cwd();

		const branch = await defaultGitRunner.getCurrentBranch(cwd);
		if (!branch) {
			renderer.error(
				"Could not determine the current branch (detached HEAD or not a git repo).",
			);
			process.exit(1);
		}

		await assertBranchPushedAndInSync(renderer, cwd, branch);

		const destination = options.base ?? (await defaultBase(renderer, cwd));

		const body = await resolveBodyInput({
			body: options.body,
			bodyFile: options.bodyFile,
		});

		// Bitbucket's POST /pullrequests does not honor the repo's default
		// reviewers configuration. To match the web UI we read the effective
		// list (repo + project-inherited) and inline the UUIDs in the POST,
		// minus the authenticated user (Bitbucket rejects a body where the
		// author is also a reviewer). Failures here MUST propagate — we never
		// silently create a reviewerless PR; that's the bug we're fixing.
		const [me, defaultReviewerUuids] = await Promise.all([
			getCurrentUser(config),
			listEffectiveDefaultReviewers(config, ref),
		]);
		const reviewerUuids = defaultReviewerUuids.filter(
			(uuid) => uuid !== me.uuid,
		);

		const pr = await createPullRequest(config, ref, {
			title: options.title,
			description: body,
			sourceBranch: branch,
			destinationBranch: destination,
			draft: options.draft,
			reviewerUuids,
		});

		renderer.message(pr.url);
	} catch (err) {
		if (
			err instanceof RepositoryResolutionError ||
			err instanceof PullRequestError ||
			err instanceof UserError ||
			err instanceof BodyInputError ||
			err instanceof EditorError
		) {
			renderer.error(err.message);
			process.exit(1);
		}
		throw err;
	}
}

async function assertBranchPushedAndInSync(
	renderer: Renderer,
	cwd: string,
	branch: string,
): Promise<void> {
	const remoteSha = await defaultGitRunner.getRemoteBranchSha(
		cwd,
		"origin",
		branch,
	);
	if (!remoteSha) {
		renderer.error(
			`Branch '${branch}' is not on origin. Push it first: git push -u origin ${branch}`,
		);
		process.exit(1);
	}
	const localSha = await defaultGitRunner.getSha(cwd, "HEAD");
	if (localSha && localSha !== remoteSha) {
		renderer.error(
			`Branch '${branch}' has unpushed commits (local ${localSha.slice(0, 7)} vs remote ${remoteSha.slice(0, 7)}). Push them first.`,
		);
		process.exit(1);
	}
}

async function defaultBase(renderer: Renderer, cwd: string): Promise<string> {
	const branch = await defaultGitRunner.getDefaultBranchFromRemote(
		cwd,
		"origin",
	);
	if (!branch) {
		renderer.error(
			"Could not determine the default branch. Run 'git remote set-head origin --auto' or pass --base explicitly.",
		);
		process.exit(1);
	}
	return branch;
}
