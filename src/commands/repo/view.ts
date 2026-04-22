import {
	getRepository,
	type Repository,
	RepositoryError,
} from "../../backend/repositories/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import {
	RepositoryResolutionError,
	resolveRepository,
} from "../../shared/repository/index.ts";
import { formatRelativeTime } from "../../shared/time/index.ts";

export type RepoViewOptions = {
	repository?: string;
};

/**
 * Shows metadata for a single repository. Argument precedence when both a
 * positional ref and `--repository` are given: positional wins — users
 * typing `bb repo view some/repo` expect that to act on `some/repo`
 * without having to remember which flag takes priority.
 */
export async function runRepoView(
	renderer: Renderer,
	refArg: string | undefined,
	options: RepoViewOptions,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	try {
		const override = refArg ?? options.repository;
		const ref = await resolveRepository({ override });
		const repo = await getRepository(config, ref);
		render(renderer, repo);
	} catch (err) {
		if (
			err instanceof RepositoryResolutionError ||
			err instanceof RepositoryError
		) {
			renderer.error(err.message);
			process.exit(1);
		}
		throw err;
	}
}

function render(renderer: Renderer, repo: Repository): void {
	renderer.detail(repo, [
		{ label: "NAME", value: (r) => r.fullName, style: "bold" },
		{ label: "OWNER", value: (r) => r.owner || "(unknown)", style: "muted" },
		{
			label: "VISIBILITY",
			value: (r) => (r.isPrivate ? "private" : "public"),
		},
		{
			label: "DEFAULT BRANCH",
			value: (r) => r.defaultBranch || "(empty repo)",
		},
		{
			label: "LANGUAGE",
			value: (r) => r.language || "(unset)",
			style: "muted",
		},
		{
			label: "CREATED",
			value: (r) => (r.createdOn ? formatRelativeTime(r.createdOn) : ""),
			style: "muted",
		},
		{
			label: "UPDATED",
			value: (r) => (r.updatedOn ? formatRelativeTime(r.updatedOn) : ""),
			style: "muted",
		},
		{ label: "URL", value: (r) => r.url, style: "muted" },
	]);

	renderer.message("");
	renderer.message("DESCRIPTION");
	renderer.message(repo.description.trim() || "(no description)");
}
