import type { components } from "../../shared/bitbucket-http/generated";
import {
	type Credentials,
	createBitbucketClient,
} from "../../shared/bitbucket-http/index.ts";

type RawRepository = components["schemas"]["repository"];

export type Repository = {
	/** `workspace/slug` (matches what Bitbucket uses in URLs and BBQL). */
	fullName: string;
	name: string;
	/** Username or team name; may be empty when the API omits `owner`. */
	owner: string;
	description: string;
	/** Default/main branch name, or empty when the repo is empty. */
	defaultBranch: string;
	language: string;
	isPrivate: boolean;
	createdOn: string;
	updatedOn: string;
	size: number;
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

/**
 * Fetches a single repository by workspace/slug. Maps the sparse
 * optional fields of the generated `repository` schema down to a flat
 * surface the UI can render without defensive guards.
 */
export async function getRepository(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
): Promise<Repository> {
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

	return toRepository(data as RawRepository);
}

function toRepository(raw: RawRepository): Repository {
	const r = raw as Record<string, any>;
	return {
		fullName: String(r.full_name ?? ""),
		name: String(r.name ?? ""),
		owner: String(
			r.owner?.display_name ?? r.owner?.nickname ?? r.owner?.username ?? "",
		),
		description: String(r.description ?? ""),
		defaultBranch: String(r.mainbranch?.name ?? ""),
		language: String(r.language ?? ""),
		isPrivate: Boolean(r.is_private ?? false),
		createdOn: String(r.created_on ?? ""),
		updatedOn: String(r.updated_on ?? ""),
		size: Number(r.size ?? 0),
		url: String(r.links?.html?.href ?? ""),
	};
}
