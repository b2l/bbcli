export type RepositoryRef = { workspace: string; slug: string };

/**
 * Parses a Bitbucket Cloud remote URL into a workspace/slug pair.
 * Accepts the four shapes git clones produce:
 *   - git@bitbucket.org:ws/repo(.git)?
 *   - ssh://git@bitbucket.org/ws/repo(.git)?
 *   - https://bitbucket.org/ws/repo(.git)?
 *   - https://user@bitbucket.org/ws/repo(.git)?
 * The host must be `bitbucket.org` or `bitbucket.com` — subdomains and other
 * hosts are rejected. Returns null when the URL doesn't match (caller decides
 * the error).
 */
export function parseBitbucketRemoteUrl(url: string): RepositoryRef | null {
	const trimmed = url.trim();
	if (!trimmed) return null;

	// scp-like SSH: git@bitbucket.org:ws/repo(.git)? (also bitbucket.com)
	const scp = /^git@bitbucket\.(?:org|com):([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(
		trimmed,
	);
	if (scp) return normalize(scp[1]!, scp[2]!);

	// URL-shaped: ssh://, https://, http:// with optional user info.
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return null;
	}

	const host = parsed.hostname.toLowerCase();
	if (host !== "bitbucket.org" && host !== "bitbucket.com") return null;
	if (!["https:", "http:", "ssh:"].includes(parsed.protocol)) return null;

	const segments = parsed.pathname.split("/").filter(Boolean);
	if (segments.length !== 2) return null;

	const workspace = segments[0]!;
	const slug = segments[1]!.replace(/\.git$/, "");
	return normalize(workspace, slug);
}

function normalize(workspace: string, slug: string): RepositoryRef | null {
	const ws = workspace.trim().toLowerCase();
	const sl = slug.trim().toLowerCase();
	if (!ws || !sl) return null;
	return { workspace: ws, slug: sl };
}
