import { $ } from "bun";
import {
	getRepositoryCloneLinks,
	RepositoryError,
} from "../../backend/repositories/index.ts";
import { listWorkspaces } from "../../backend/workspaces/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import { resolveRepository } from "../../shared/repository/index.ts";
import {
	resolveWorkspace,
	WorkspaceResolutionError,
} from "../../shared/workspace/index.ts";

export type RepoCloneOptions = {
	repository?: string;
	https?: boolean;
};

export async function runRepoClone(
	renderer: Renderer,
	repo: string,
	options: RepoCloneOptions,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	const { workspace: explicitWs, slug } = parseRepoArg(repo);

	try {
		const workspace = await resolveWorkspace(
			explicitWs ?? options.repository,
			async () => {
				try {
					return (await resolveRepository({})).workspace;
				} catch {
					return undefined;
				}
			},
			async () => (await listWorkspaces(config)).map((w) => w.slug),
		);

		const links = await getRepositoryCloneLinks(config, {
			workspace,
			slug,
		});

		const cloneUrl = options.https
			? (links.https ?? links.ssh)
			: (links.ssh ?? links.https);

		if (!cloneUrl) {
			renderer.error(
				`No clone URL found for ${workspace}/${slug}. The repository may not exist or you may lack access.`,
			);
			process.exit(1);
		}

		renderer.message(`Cloning ${workspace}/${slug}...`);

		const result = await $`git clone ${cloneUrl}`.nothrow();
		if (result.exitCode !== 0) {
			process.exit(result.exitCode);
		}
	} catch (err) {
		if (
			err instanceof WorkspaceResolutionError ||
			err instanceof RepositoryError
		) {
			renderer.error(err.message);
			process.exit(1);
		}
		throw err;
	}
}

/**
 * Parses the repo argument. Supports two forms:
 * - `workspace/repo` — returns both parts (lowercased)
 * - `repo` — returns slug only; workspace resolved later
 */
function parseRepoArg(repo: string): {
	workspace: string | undefined;
	slug: string;
} {
	const match = /^([^/\s]+)\/([^/\s]+)$/.exec(repo.trim());
	if (match) {
		return {
			workspace: match[1]!.toLowerCase(),
			slug: match[2]!.toLowerCase(),
		};
	}
	return { workspace: undefined, slug: repo.trim().toLowerCase() };
}
