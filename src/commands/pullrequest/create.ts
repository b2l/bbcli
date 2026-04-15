import {
	createPullRequest,
	PullRequestError,
} from "../../backend/pullrequests/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import { EditorError, openEditor } from "../../shared/editor/index.ts";
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

		const body = await resolveBody(renderer, options);

		const pr = await createPullRequest(config, ref, {
			title: options.title,
			description: body,
			sourceBranch: branch,
			destinationBranch: destination,
			draft: options.draft,
		});

		renderer.message(pr.url);
	} catch (err) {
		if (
			err instanceof RepositoryResolutionError ||
			err instanceof PullRequestError ||
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

async function resolveBody(
	renderer: Renderer,
	options: PullRequestCreateOptions,
): Promise<string> {
	if (options.body !== undefined) return options.body;
	if (options.bodyFile !== undefined) {
		const file = Bun.file(options.bodyFile);
		if (!(await file.exists())) {
			renderer.error(`--body-file '${options.bodyFile}' does not exist.`);
			process.exit(1);
		}
		return await file.text();
	}
	// No flag: drop into the user's editor with a blank file.
	return await openEditor();
}
