import { $ } from "bun";
import {
	getRepositoryCloneLinks,
	RepositoryError,
} from "../../backend/repositories/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import { resolveWorkspaceOrExit } from "./resolve-workspace.ts";

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
	const workspace = await resolveWorkspaceOrExit(
		renderer,
		config,
		explicitWs ?? options.repository,
	);

	let cloneUrl: string;
	try {
		const links = await getRepositoryCloneLinks(config, {
			workspace,
			slug,
		});

		if (options.https) {
			cloneUrl = links.https ?? links.ssh ?? "";
		} else {
			cloneUrl = links.ssh ?? links.https ?? "";
		}

		if (!cloneUrl) {
			renderer.error(
				`No clone URL found for ${workspace}/${slug}. The repository may not exist or you may lack access.`,
			);
			process.exit(1);
		}
	} catch (err) {
		if (err instanceof RepositoryError) {
			renderer.error(err.message);
			process.exit(1);
		}
		throw err;
	}

	renderer.message(`Cloning ${workspace}/${slug}...`);

	const result = await $`git clone ${cloneUrl}`.nothrow();
	if (result.exitCode !== 0) {
		process.exit(result.exitCode);
	}
}

/**
 * Parses the repo argument. Supports two forms:
 * - `workspace/repo` — returns both parts
 * - `repo` — returns slug only; workspace resolved later
 */
function parseRepoArg(repo: string): {
	workspace: string | undefined;
	slug: string;
} {
	const parts = repo.split("/");
	if (parts.length === 2 && parts[0] && parts[1]) {
		return { workspace: parts[0], slug: parts[1] };
	}
	return { workspace: undefined, slug: repo };
}
