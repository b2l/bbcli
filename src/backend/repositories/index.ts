import type { components } from "../../shared/bitbucket-http/generated";
import {
	type Credentials,
	createBitbucketClient,
} from "../../shared/bitbucket-http/index.ts";
import {
	PaginationError,
	withPagination,
} from "../../shared/bitbucket-http/paginate.ts";

type RawRepository = components["schemas"]["repository"];

export type Repository = {
	slug: string;
	name: string;
	fullName: string;
	description: string;
	isPrivate: boolean;
	language: string;
	updatedOn: string;
	url: string;
};

export class RepositoryError extends Error {
	readonly status: number | undefined;

	constructor(message: string, status?: number) {
		super(message);
		this.name = "RepositoryError";
		this.status = status;
	}
}

export type ListRepositoriesOptions = {
	limit: number;
	query?: string;
};

const PAGELEN = 50;

export async function listRepositories(
	credentials: Credentials,
	workspace: string,
	options: ListRepositoriesOptions,
): Promise<Repository[]> {
	const client = createBitbucketClient(credentials);

	const query: Record<string, unknown> = {
		sort: "-updated_on",
		pagelen: PAGELEN,
	};
	if (options.query) {
		query.q = `name ~ "${escapeBbql(options.query)}"`;
	}

	try {
		const raw = await withPagination(
			() =>
				client.GET("/repositories/{workspace}", {
					params: {
						path: { workspace },
						query,
					},
				}),
			credentials,
			{ limit: options.limit },
		);
		return raw.map(toRepository);
	} catch (err) {
		if (err instanceof PaginationError) {
			throw new RepositoryError(err.message, err.status);
		}
		throw err;
	}
}

/**
 * Fetches clone links for a single repository. Returns the SSH and HTTPS
 * URLs from the `links.clone` array. Used by `bb repo clone` to resolve
 * `workspace/repo` shorthand into a git-cloneable URL.
 */
export async function getRepositoryCloneLinks(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
): Promise<{ ssh?: string; https?: string }> {
	const client = createBitbucketClient(credentials);
	const { data, response } = await client.GET(
		"/repositories/{workspace}/{repo_slug}",
		{
			params: {
				path: { workspace: ref.workspace, repo_slug: ref.slug },
			},
		},
	);

	if (!response.ok || !data) {
		throw new RepositoryError(
			`Failed to fetch repository ${ref.workspace}/${ref.slug}: HTTP ${response.status}.`,
			response.status,
		);
	}

	const raw = data as Record<string, any>;
	const cloneLinks: Array<{ name?: string; href?: string }> =
		raw.links?.clone ?? [];

	let ssh: string | undefined;
	let https: string | undefined;
	for (const link of cloneLinks) {
		if (link.name === "ssh") ssh = link.href;
		if (link.name === "https") https = link.href;
	}
	return { ssh, https };
}

function toRepository(raw: RawRepository): Repository {
	const r = raw as Record<string, any>;
	return {
		slug: String(r.slug ?? ""),
		name: String(r.name ?? ""),
		fullName: String(r.full_name ?? ""),
		description: String(r.description ?? ""),
		isPrivate: Boolean(r.is_private),
		language: String(r.language ?? ""),
		updatedOn: String(r.updated_on ?? ""),
		url: String(r.links?.html?.href ?? ""),
	};
}

function escapeBbql(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
