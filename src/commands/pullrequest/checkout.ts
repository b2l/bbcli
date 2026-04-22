import {
	getPullRequest,
	type PullRequestDetail,
	PullRequestError,
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

export type PullRequestCheckoutOptions = {
	repository?: string;
};

/**
 * Fetches the PR's source branch and either creates a local branch tracking
 * it, or fast-forwards an existing local branch. Same-repo PRs only — fork
 * checkouts are out of scope (and meaningfully harder: need a temporary
 * remote, branch rename to avoid collisions, and cleanup semantics).
 */
export async function runPullRequestCheckout(
	renderer: Renderer,
	idArg: string,
	options: PullRequestCheckoutOptions,
	git: GitRunner = defaultGitRunner,
): Promise<void> {
	const id = parseId(idArg);
	if (id === null) {
		renderer.error(`Invalid PR id '${idArg}'. Expected a positive integer.`);
		process.exit(1);
	}

	const config = await loadConfigOrExit(renderer);

	try {
		const ref = await resolveRepository({ override: options.repository });
		const pr = await getPullRequest(config, ref, id);

		ensureSameRepo(pr, ref);

		const branch = pr.sourceBranch;
		if (!branch) {
			renderer.error(
				`Pull request #${id} has no source branch — nothing to check out.`,
			);
			process.exit(1);
		}

		const cwd = process.cwd();
		const remote = "origin";
		const remoteRef = `${remote}/${branch}`;

		await git.fetchRef(cwd, remote, branch);

		const existed = await git.hasLocalBranch(cwd, branch);
		if (existed) {
			await git.checkoutExistingBranch(cwd, branch);
			await git.mergeFastForwardOnly(cwd, remoteRef);
		} else {
			await git.checkoutCreateTracking(cwd, branch, remoteRef);
		}

		const action = existed ? "fast-forwarded" : "created";
		if (renderer.json) {
			renderer.detail({ id, branch, action }, []);
			return;
		}
		renderer.message(
			existed
				? `Checked out pull request #${id}: ${branch} (fast-forwarded).`
				: `Checked out pull request #${id}: ${branch}.`,
		);
	} catch (err) {
		if (
			err instanceof RepositoryResolutionError ||
			err instanceof PullRequestError
		) {
			renderer.error(err.message);
			process.exit(1);
		}
		if (err instanceof GitError) {
			// Surface git's own stderr verbatim — it's almost always clearer
			// than anything we could paraphrase (dirty working tree, diverged
			// branches, missing remote ref, etc.).
			renderer.error(err.message);
			process.exit(1);
		}
		throw err;
	}
}

function ensureSameRepo(
	pr: PullRequestDetail,
	ref: { workspace: string; slug: string },
): void {
	const source = pr.sourceRepositoryFullName;
	const destination = pr.destinationRepositoryFullName;
	// Empty strings mean Bitbucket didn't send the field — treat as same-repo
	// (the common case for non-fork PRs; the server sometimes omits the
	// repository reference when source == destination).
	if (!source || !destination) return;
	if (source.toLowerCase() === destination.toLowerCase()) return;
	throw new PullRequestError(
		`Pull request source repo '${source}' differs from '${ref.workspace}/${ref.slug}'. ` +
			"Fork-based PR checkout is not supported yet — open a follow-up if you need this.",
	);
}

function parseId(raw: string): number | null {
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) return null;
	return n;
}
