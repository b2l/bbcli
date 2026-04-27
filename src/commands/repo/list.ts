import {
	listRepositories,
	RepositoryError,
} from "../../backend/repositories/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import { formatRelativeTime } from "../../shared/time/index.ts";
import { resolveWorkspaceOrExit } from "./resolve-workspace.ts";

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

	const workspace = await resolveWorkspaceOrExit(
		renderer,
		config,
		options.repository,
	);

	try {
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
		if (err instanceof RepositoryError) {
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
