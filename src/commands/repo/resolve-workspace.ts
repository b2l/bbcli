import {
	listWorkspaces,
	WorkspaceError,
} from "../../backend/workspaces/index.ts";
import type { Credentials } from "../../shared/bitbucket-http/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import { resolveRepository } from "../../shared/repository/index.ts";

/**
 * Resolves a workspace slug using the following fallback chain:
 *   1. Explicit override (from -R flag)
 *   2. Auto-detected from current repo's origin
 *   3. If the user has exactly one workspace, use it
 *   4. Error with the list of available workspaces
 *
 * Exits the process on failure — callers don't need to handle errors.
 */
export async function resolveWorkspaceOrExit(
	renderer: Renderer,
	credentials: Credentials,
	override?: string,
): Promise<string> {
	if (override) {
		return override.split("/")[0]!;
	}

	// Try current repo
	try {
		const ref = await resolveRepository({});
		return ref.workspace;
	} catch {
		// Not inside a BB repo — fall through
	}

	// Try workspace list
	try {
		const workspaces = await listWorkspaces(credentials);
		if (workspaces.length === 1) {
			return workspaces[0]!.slug;
		}
		if (workspaces.length === 0) {
			renderer.error("No workspaces found for your account.");
			process.exit(1);
		}
		renderer.error(
			`Multiple workspaces available. Pass -R <workspace> to specify one:\n${workspaces.map((w) => `  ${w.slug}`).join("\n")}`,
		);
		process.exit(1);
	} catch (err) {
		if (err instanceof WorkspaceError) {
			renderer.error(err.message);
			process.exit(1);
		}
		throw err;
	}
}
