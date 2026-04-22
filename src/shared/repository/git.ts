import { $ } from "bun";

/**
 * Error from a git command that was expected to succeed. Carries git's stderr
 * so callers can surface the underlying message (which is usually more
 * actionable than anything bbcli could synthesize) to the user.
 */
export class GitError extends Error {
	override name = "GitError";
	readonly stderr: string;
	readonly exitCode: number;

	constructor(message: string, exitCode: number, stderr: string) {
		super(message);
		this.exitCode = exitCode;
		this.stderr = stderr;
	}
}

/**
 * Thin wrapper around the git CLI. Injected into resolveRepository so tests
 * can simulate every failure mode without shelling out. Production code uses
 * the default implementation backed by `git -C <cwd>`.
 */
export interface GitRunner {
	isInsideWorkTree(cwd: string): Promise<boolean>;
	/** Returns remote names in the order git reports them. */
	listRemotes(cwd: string): Promise<string[]>;
	/** Returns the URL of a remote, or undefined if the remote does not exist. */
	getRemoteUrl(cwd: string, name: string): Promise<string | undefined>;
	/**
	 * Returns the current branch name, or undefined on detached HEAD / empty
	 * repo. Used to default `bb pr view` to the PR for the current branch.
	 */
	getCurrentBranch(cwd: string): Promise<string | undefined>;
	/**
	 * Returns the local commit sha of the given rev (`HEAD`, a branch name,
	 * etc.), or undefined if git can't resolve it.
	 */
	getSha(cwd: string, rev: string): Promise<string | undefined>;
	/**
	 * Queries the remote over the network for the sha a branch points at.
	 * Returns undefined when the branch doesn't exist on the remote. Used
	 * for "is this branch pushed?" checks without trusting possibly-stale
	 * local remote-tracking refs.
	 */
	getRemoteBranchSha(
		cwd: string,
		remote: string,
		branch: string,
	): Promise<string | undefined>;
	/**
	 * Returns the default branch the remote is set up to point at (via
	 * `refs/remotes/<remote>/HEAD`), or undefined if the symbolic ref
	 * isn't set locally. Reflects remote state at clone time — may be
	 * stale if the repo has renamed its default branch since.
	 */
	getDefaultBranchFromRemote(
		cwd: string,
		remote: string,
	): Promise<string | undefined>;
	/** Returns true iff a local branch with the given name exists. */
	hasLocalBranch(cwd: string, branch: string): Promise<boolean>;
	/**
	 * Switches to an existing local branch. Throws GitError on non-zero
	 * exit (most commonly: a dirty working tree that would be clobbered).
	 */
	checkoutExistingBranch(cwd: string, branch: string): Promise<void>;
	/**
	 * Deletes a local branch safely (`git branch -d`). Throws GitError on
	 * non-zero exit, which git returns when the branch hasn't been merged
	 * anywhere git can see — we never force with `-D` from this wrapper.
	 */
	deleteLocalBranch(cwd: string, branch: string): Promise<void>;
}

export const defaultGitRunner: GitRunner = {
	async isInsideWorkTree(cwd) {
		const result = await $`git -C ${cwd} rev-parse --is-inside-work-tree`
			.nothrow()
			.quiet();
		if (result.exitCode !== 0) return false;
		return result.stdout.toString().trim() === "true";
	},

	async listRemotes(cwd) {
		const result = await $`git -C ${cwd} remote`.nothrow().quiet();
		if (result.exitCode !== 0) return [];
		return result.stdout
			.toString()
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	},

	async getRemoteUrl(cwd, name) {
		const result = await $`git -C ${cwd} remote get-url ${name}`
			.nothrow()
			.quiet();
		if (result.exitCode !== 0) return undefined;
		const url = result.stdout.toString().trim();
		return url || undefined;
	},

	async getCurrentBranch(cwd) {
		// `symbolic-ref --short HEAD` returns the branch name, or exits non-zero
		// on detached HEAD. We distinguish that from "not a git repo" via the
		// separate isInsideWorkTree check callers already do.
		const result = await $`git -C ${cwd} symbolic-ref --short HEAD`
			.nothrow()
			.quiet();
		if (result.exitCode !== 0) return undefined;
		const branch = result.stdout.toString().trim();
		return branch || undefined;
	},

	async getSha(cwd, rev) {
		const result = await $`git -C ${cwd} rev-parse ${rev}`.nothrow().quiet();
		if (result.exitCode !== 0) return undefined;
		const sha = result.stdout.toString().trim();
		return sha || undefined;
	},

	async getRemoteBranchSha(cwd, remote, branch) {
		// `ls-remote` talks to the network, so this is authoritative — unlike
		// `rev-parse <remote>/<branch>` which relies on the locally-cached
		// remote-tracking ref being fresh. Output: '<sha>\trefs/heads/<branch>'
		// one line per ref (empty when the branch doesn't exist).
		const result =
			await $`git -C ${cwd} ls-remote ${remote} ${`refs/heads/${branch}`}`
				.nothrow()
				.quiet();
		if (result.exitCode !== 0) return undefined;
		const line = result.stdout.toString().trim().split("\n")[0];
		if (!line) return undefined;
		const sha = line.split(/\s+/)[0];
		return sha || undefined;
	},

	async getDefaultBranchFromRemote(cwd, remote) {
		// `refs/remotes/<remote>/HEAD` is a local symbolic ref set at clone
		// time; exits non-zero if unset. Value looks like `<remote>/main`.
		const result =
			await $`git -C ${cwd} symbolic-ref --short ${`refs/remotes/${remote}/HEAD`}`
				.nothrow()
				.quiet();
		if (result.exitCode !== 0) return undefined;
		const full = result.stdout.toString().trim();
		if (!full) return undefined;
		const prefix = `${remote}/`;
		return full.startsWith(prefix) ? full.slice(prefix.length) : full;
	},

	async hasLocalBranch(cwd, branch) {
		// `show-ref --verify --quiet` exits 0 iff the ref exists; no output.
		const result =
			await $`git -C ${cwd} show-ref --verify --quiet ${`refs/heads/${branch}`}`
				.nothrow()
				.quiet();
		return result.exitCode === 0;
	},

	async checkoutExistingBranch(cwd, branch) {
		const result = await $`git -C ${cwd} checkout ${branch}`.nothrow().quiet();
		throwIfFailed(result, `git checkout ${branch}`);
	},

	async deleteLocalBranch(cwd, branch) {
		const result = await $`git -C ${cwd} branch -d ${branch}`.nothrow().quiet();
		throwIfFailed(result, `git branch -d ${branch}`);
	},
};

function throwIfFailed(
	result: { exitCode: number; stderr: Buffer; stdout: Buffer },
	command: string,
): void {
	if (result.exitCode === 0) return;
	const stderr = result.stderr.toString().trim();
	const stdout = result.stdout.toString().trim();
	// Git writes most diagnostics to stderr, but a few to stdout; prefer
	// stderr, fall back to stdout so we never lose the actual reason.
	const message =
		stderr || stdout || `${command} exited with code ${result.exitCode}`;
	throw new GitError(message, result.exitCode, stderr);
}
