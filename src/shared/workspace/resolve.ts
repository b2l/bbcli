/**
 * Resolves a workspace slug using a fallback chain:
 *   1. Explicit override (e.g. from -R flag) — first segment before `/`
 *   2. Auto-detected from current repo's origin
 *   3. If the user has exactly one workspace, use it
 *   4. Error with the list of available workspaces
 *
 * Dependencies are injected so this module stays in `shared/` without
 * importing `backend/`. Callers wire the real implementations.
 */

export class WorkspaceResolutionError extends Error {
	override name = "WorkspaceResolutionError";
}

/**
 * @param override   Explicit workspace or workspace/repo from a CLI flag.
 * @param detectFromRepo  Returns the workspace slug from the current git
 *   repo's origin, or undefined if not inside a Bitbucket repo.
 * @param fetchWorkspaceSlugs  Returns all workspace slugs the user has
 *   access to. Called only when the first two strategies fail.
 */
export async function resolveWorkspace(
	override: string | undefined,
	detectFromRepo: () => Promise<string | undefined>,
	fetchWorkspaceSlugs: () => Promise<string[]>,
): Promise<string> {
	if (override) {
		return override.split("/")[0]!;
	}

	const fromRepo = await detectFromRepo();
	if (fromRepo) return fromRepo;

	const slugs = await fetchWorkspaceSlugs();
	if (slugs.length === 1) {
		return slugs[0]!;
	}
	if (slugs.length === 0) {
		throw new WorkspaceResolutionError("No workspaces found for your account.");
	}
	throw new WorkspaceResolutionError(
		`Multiple workspaces available. Pass -R <workspace> to specify one:\n${slugs.map((s) => `  ${s}`).join("\n")}`,
	);
}
