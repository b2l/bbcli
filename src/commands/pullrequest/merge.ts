import {
	getMergeTaskStatus,
	getPullRequest,
	isMergeStrategy,
	MERGE_STRATEGIES,
	type MergeStrategy,
	mergePullRequest,
	type PullRequestDetail,
	PullRequestError,
	type PullRequestState,
} from "../../backend/pullrequests/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import {
	defaultGitRunner,
	GitError,
	type GitRunner,
	RepositoryResolutionError,
	resolveRepository,
} from "../../shared/repository/index.ts";
import { resolveCurrentPullRequestId } from "./current.ts";

export type PullRequestMergeOptions = {
	repository?: string;
	strategy?: string;
	message?: string;
	delete?: boolean;
};

const TERMINAL_STATES: ReadonlySet<PullRequestState> = new Set([
	"MERGED",
	"DECLINED",
	"SUPERSEDED",
]);

/** Bitbucket's own fallback when the destination branch has no configured default. */
const API_DEFAULT_STRATEGY: MergeStrategy = "merge_commit";

/**
 * Budget for polling an async (202) merge. 15 tries * ~2s backoff ≈ 30s
 * before giving up — plenty for ordinary merges, short enough to not feel
 * stuck. Callers can always re-run; the task is server-side and persists.
 */
const POLL_MAX_ATTEMPTS = 15;
const POLL_INITIAL_MS = 500;
const POLL_MAX_MS = 4000;

export async function runPullRequestMerge(
	renderer: Renderer,
	idArg: string | undefined,
	options: PullRequestMergeOptions,
	git: GitRunner = defaultGitRunner,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	try {
		const ref = await resolveRepository({ override: options.repository });
		const id = await resolveCurrentPullRequestId(idArg, {
			renderer,
			config,
			ref,
			commandName: "merge",
		});

		const pr = await getPullRequest(config, ref, id);
		if (TERMINAL_STATES.has(pr.state)) {
			renderer.error(
				`Pull request #${id} is ${pr.state.toLowerCase()}; cannot merge.`,
			);
			process.exit(1);
		}

		const strategy = resolveStrategy(renderer, pr, options.strategy);

		const result = await mergePullRequest(config, ref, id, {
			mergeStrategy: strategy,
			...(options.message !== undefined ? { message: options.message } : {}),
			// Only include close_source_branch when --delete is set. Omitting
			// it lets the PR's created-with value apply; passing `false`
			// would override it for this merge and could surprise users who
			// created the PR with "delete branch on merge" checked.
			...(options.delete ? { closeSourceBranch: true } : {}),
		});

		const merged =
			result.kind === "done"
				? result.pr
				: await pollUntilDone(config, result.taskUrl, renderer);

		if (renderer.json) {
			renderer.detail(merged, []);
		} else {
			renderer.message(`Merged pull request #${id}: ${merged.url}`);
		}

		if (options.delete) {
			await cleanupLocalSourceBranch(renderer, git, pr);
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

function resolveStrategy(
	renderer: Renderer,
	pr: PullRequestDetail,
	raw: string | undefined,
): MergeStrategy {
	if (raw !== undefined) {
		if (!isMergeStrategy(raw)) {
			renderer.error(
				`Unknown merge strategy '${raw}'. Allowed: ${MERGE_STRATEGIES.join(", ")}.`,
			);
			process.exit(1);
		}
		// Validate against the branch's allowed list when Bitbucket populated
		// it. Empty list means "no restriction" (or the server didn't report
		// the field) — fall through and let the API have the final word.
		if (
			pr.allowedMergeStrategies.length > 0 &&
			!pr.allowedMergeStrategies.includes(raw)
		) {
			renderer.error(
				`Merge strategy '${raw}' is not allowed on branch '${pr.destinationBranch}'. Allowed: ${pr.allowedMergeStrategies.join(", ")}.`,
			);
			process.exit(1);
		}
		return raw;
	}

	// No --strategy: use the branch's default; fall back to Bitbucket's own
	// default if none configured.
	return pr.defaultMergeStrategy ?? API_DEFAULT_STRATEGY;
}

/**
 * Polls a 202 task-status URL with capped exponential backoff until the
 * merge reaches a terminal state or we exhaust the attempt budget. Returns
 * the merged PR on success; errors surface as PullRequestError from the
 * backend and bubble up to runPullRequestMerge.
 */
async function pollUntilDone(
	credentials: Parameters<typeof getMergeTaskStatus>[0],
	taskUrl: string,
	renderer: Renderer,
): Promise<PullRequestDetail> {
	renderer.message("Merge accepted — polling task status…");
	let delay = POLL_INITIAL_MS;
	for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
		const status = await getMergeTaskStatus(credentials, taskUrl);
		if (status.status === "SUCCESS") return status.pr;
		if (status.status === "FAILED") {
			throw new PullRequestError(`Merge task failed: ${status.error}`);
		}
		await sleep(delay);
		delay = Math.min(delay * 2, POLL_MAX_MS);
	}
	throw new PullRequestError(
		`Merge task did not finish within ${POLL_MAX_ATTEMPTS} polls. Re-run the merge to check its current state.`,
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Best-effort local cleanup after `--delete`. Guards against the usual
 * footguns: only deletes the local branch if its name matches the PR's
 * source (so we never wipe a branch with the same name from a different
 * origin); switches off it first when it's currently checked out.
 *
 * Errors here are non-fatal — the merge already landed. Surface them as
 * warnings so the user knows the local branch wasn't cleaned up but the
 * command's exit status still reflects the successful merge.
 */
async function cleanupLocalSourceBranch(
	renderer: Renderer,
	git: GitRunner,
	pr: PullRequestDetail,
): Promise<void> {
	const cwd = process.cwd();
	const source = pr.sourceBranch;
	const destination = pr.destinationBranch;

	if (!source) return;
	try {
		if (!(await git.hasLocalBranch(cwd, source))) return;

		const current = await git.getCurrentBranch(cwd);
		if (current === source) {
			// Can't delete the branch we're on — try switching to the
			// destination first. If that branch doesn't exist locally or the
			// checkout errors (dirty tree), bail out with a warning.
			if (!destination || !(await git.hasLocalBranch(cwd, destination))) {
				renderer.message(
					`Warning: did not delete local branch '${source}' — no local '${destination}' to switch to first. Run 'git checkout <branch> && git branch -d ${source}' manually.`,
				);
				return;
			}
			await git.checkoutExistingBranch(cwd, destination);
		}

		await git.deleteLocalBranch(cwd, source);
		renderer.message(`Deleted local branch '${source}'.`);
	} catch (err) {
		if (err instanceof GitError) {
			renderer.message(
				`Warning: could not clean up local branch '${source}': ${err.message}`,
			);
			return;
		}
		throw err;
	}
}
