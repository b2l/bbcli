import {
	listRepositories,
	RepositoryError,
} from "../../backend/repositories/index.ts";
import { listWorkspaces } from "../../backend/workspaces/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import { resolveRepository } from "../../shared/repository/index.ts";
import { formatRelativeTime } from "../../shared/time/index.ts";
import {
	resolveWorkspace,
	WorkspaceResolutionError,
} from "../../shared/workspace/index.ts";

export type RepoListOptions = {
	repository?: string;
	limit?: string;
	query?: string;
};

const DEFAULT_LIMIT = 30;

export async function runRepoList(
	renderer: Renderer,
	options: RepoListOptions,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	const limit = parseLimit(options.limit);
	if (limit === null) {
		renderer.error(
			`Invalid --limit '${options.limit}'. Expected a positive integer.`,
		);
		process.exit(1);
	}

	try {
		const workspace = await resolveWorkspace(
			options.repository,
			async () => {
				try {
					return (await resolveRepository({})).workspace;
				} catch {
					return undefined;
				}
			},
			async () => (await listWorkspaces(config)).map((w) => w.slug),
		);

		const repos = await listRepositories(config, workspace, {
			limit,
			query: options.query,
		});

		if (repos.length === 0) {
			renderer.message("No repositories found.");
			return;
		}

		renderer.list(repos, [
			{ header: "NAME", value: (r) => r.fullName, flex: true },
			{
				header: "VISIBILITY",
				value: (r) => (r.isPrivate ? "private" : "public"),
				style: "muted",
			},
			{
				header: "LANGUAGE",
				value: (r) => r.language || "-",
				style: "muted",
			},
			{
				header: "UPDATED",
				value: (r) => formatRelativeTime(r.updatedOn),
				style: "muted",
			},
		]);
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

function parseLimit(raw: string | undefined): number | null {
	if (raw === undefined) return DEFAULT_LIMIT;
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) return null;
	return n;
}
