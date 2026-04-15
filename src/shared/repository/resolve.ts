import { defaultGitRunner, type GitRunner } from "./git.ts";
import { parseBitbucketRemoteUrl, type RepositoryRef } from "./parse-url.ts";

export type ResolutionFailure =
	| { kind: "override-invalid"; value: string }
	| { kind: "not-a-git-repo"; cwd: string }
	| { kind: "no-remotes" }
	| { kind: "no-origin"; remotes: string[] }
	| { kind: "origin-not-bitbucket"; url: string }
	| { kind: "origin-unparseable"; url: string };

const OVERRIDE_HINT =
	"Pass -R <workspace>/<repo> to specify a repository explicitly.";

export class RepositoryResolutionError extends Error {
	override name = "RepositoryResolutionError";
	readonly failure: ResolutionFailure;

	constructor(failure: ResolutionFailure) {
		super(formatFailure(failure));
		this.failure = failure;
	}
}

export type ResolveOptions = {
	override?: string | undefined;
	cwd?: string;
};

export async function resolveRepository(
	options: ResolveOptions,
	git: GitRunner = defaultGitRunner,
): Promise<RepositoryRef> {
	if (options.override !== undefined) {
		const parsed = parseOverride(options.override);
		if (!parsed) {
			throw new RepositoryResolutionError({
				kind: "override-invalid",
				value: options.override,
			});
		}
		return parsed;
	}

	const cwd = options.cwd ?? process.cwd();

	if (!(await git.isInsideWorkTree(cwd))) {
		throw new RepositoryResolutionError({ kind: "not-a-git-repo", cwd });
	}

	const remotes = await git.listRemotes(cwd);
	if (remotes.length === 0) {
		throw new RepositoryResolutionError({ kind: "no-remotes" });
	}

	if (!remotes.includes("origin")) {
		throw new RepositoryResolutionError({ kind: "no-origin", remotes });
	}

	const url = await git.getRemoteUrl(cwd, "origin");
	// listRemotes reported 'origin', so a missing URL here is a genuinely
	// broken local config — treat it the same as an unparseable URL.
	if (!url) {
		throw new RepositoryResolutionError({
			kind: "origin-unparseable",
			url: "",
		});
	}

	const parsed = parseBitbucketRemoteUrl(url);
	if (parsed) return parsed;

	// Distinguish "well-formed URL for a different host" from "garbage".
	if (looksLikeKnownHost(url)) {
		throw new RepositoryResolutionError({ kind: "origin-not-bitbucket", url });
	}
	throw new RepositoryResolutionError({ kind: "origin-unparseable", url });
}

function parseOverride(value: string): RepositoryRef | null {
	const trimmed = value.trim();
	const match = /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
	if (!match) return null;
	return { workspace: match[1]!.toLowerCase(), slug: match[2]!.toLowerCase() };
}

function looksLikeKnownHost(url: string): boolean {
	// scp-like: user@host:path
	if (/^[\w.-]+@[\w.-]+:/.test(url)) return true;
	try {
		const parsed = new URL(url);
		return Boolean(parsed.hostname);
	} catch {
		return false;
	}
}

function formatFailure(failure: ResolutionFailure): string {
	switch (failure.kind) {
		case "override-invalid":
			return `Invalid --repository value '${failure.value}'. Expected format: workspace/repo.`;
		case "not-a-git-repo":
			return `Not inside a git repository (cwd: ${failure.cwd}). ${OVERRIDE_HINT}`;
		case "no-remotes":
			return `This git repository has no remotes configured. ${OVERRIDE_HINT}`;
		case "no-origin":
			return `No 'origin' remote found. Available remotes: ${failure.remotes.join(", ")}. ${OVERRIDE_HINT}`;
		case "origin-not-bitbucket":
			return `Remote 'origin' (${failure.url}) is not a Bitbucket Cloud URL. ${OVERRIDE_HINT}`;
		case "origin-unparseable":
			return failure.url
				? `Could not parse remote 'origin' URL '${failure.url}'. ${OVERRIDE_HINT}`
				: `Remote 'origin' has no URL configured. ${OVERRIDE_HINT}`;
	}
}
