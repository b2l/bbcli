import type { components } from "../../shared/bitbucket-http/generated";
import {
	type Credentials,
	createBitbucketClient,
} from "../../shared/bitbucket-http/index.ts";
import {
	PaginationError,
	withPagination,
} from "../../shared/bitbucket-http/paginate.ts";

type RawPullRequest = components["schemas"]["pullrequest"];
type RawParticipant = components["schemas"]["participant"];

export type PullRequestStateFilter = "open" | "merged" | "declined" | "all";

export type PullRequestApiState = "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED";

export type UserFilter = { kind: "me" } | { kind: "nickname"; value: string };

export type PullRequestState =
	| "OPEN"
	| "DRAFT"
	| "QUEUED"
	| "MERGED"
	| "DECLINED"
	| "SUPERSEDED";

export type PullRequestAuthor = {
	uuid: string;
	displayName: string;
	nickname: string;
};

export type PullRequest = {
	id: number;
	title: string;
	state: PullRequestState;
	author: PullRequestAuthor | null;
	createdOn: string;
	updatedOn: string;
	url: string;
};

export type ReviewState = "approved" | "changes_requested" | "pending";

export type Reviewer = {
	account: PullRequestAuthor;
	state: ReviewState;
};

export type PullRequestDetail = PullRequest & {
	description: string;
	sourceBranch: string;
	destinationBranch: string;
	reviewers: Reviewer[];
};

export type ListPullRequestsOptions = {
	state: PullRequestStateFilter;
	author?: UserFilter;
	reviewer?: UserFilter;
	limit: number;
	/** Pre-resolved uuid of the authenticated user; required only when an @me filter is used. */
	currentUserUuid?: string;
};

export class PullRequestError extends Error {
	readonly status: number | undefined;

	constructor(message: string, status?: number) {
		super(message);
		this.name = "PullRequestError";
		this.status = status;
	}
}

const STATE_MAP: Record<PullRequestStateFilter, PullRequestApiState[]> = {
	open: ["OPEN"],
	merged: ["MERGED"],
	declined: ["DECLINED"],
	all: ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"],
};

const PAGELEN = 50;

export async function listPullRequests(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
	options: ListPullRequestsOptions,
): Promise<PullRequest[]> {
	const client = createBitbucketClient(credentials);
	const states = STATE_MAP[options.state];
	const filterBbql = buildBbql(options);

	// Bitbucket ignores the `state=` query param when `q` is also set, so
	// when we have a BBQL filter the state constraint has to live inside it.
	const query = filterBbql
		? {
				sort: "-updated_on",
				pagelen: PAGELEN,
				q: `${stateBbql(states)} AND ${filterBbql}`,
			}
		: { sort: "-updated_on", pagelen: PAGELEN, state: states };

	try {
		const raw = await withPagination(
			() =>
				client.GET("/repositories/{workspace}/{repo_slug}/pullrequests", {
					params: {
						path: { workspace: ref.workspace, repo_slug: ref.slug },
						query,
					},
				}),
			credentials,
			{ limit: options.limit },
		);
		return raw.map(toPullRequest);
	} catch (err) {
		if (err instanceof PaginationError) {
			// Re-wrap as a domain error so the command layer only needs to know
			// about PullRequestError.
			throw new PullRequestError(err.message, err.status);
		}
		throw err;
	}
}

function toPullRequest(pr: RawPullRequest): PullRequest {
	const raw = pr as Record<string, any>;
	return {
		id: Number(raw.id ?? 0),
		title: String(raw.title ?? ""),
		state: String(raw.state ?? "") as PullRequestState,
		author: toAuthor(raw.author),
		createdOn: String(raw.created_on ?? ""),
		updatedOn: String(raw.updated_on ?? ""),
		url: String(raw.links?.html?.href ?? ""),
	};
}

function toAuthor(raw: unknown): PullRequestAuthor | null {
	if (!raw || typeof raw !== "object") return null;
	const a = raw as Record<string, unknown>;
	const uuid = typeof a.uuid === "string" ? a.uuid : "";
	if (!uuid) return null;
	return {
		uuid,
		displayName: typeof a.display_name === "string" ? a.display_name : "",
		nickname: typeof a.nickname === "string" ? a.nickname : "",
	};
}

function stateBbql(states: PullRequestApiState[]): string {
	if (states.length === 1) return `state="${states[0]}"`;
	return `(${states.map((s) => `state="${s}"`).join(" OR ")})`;
}

function buildBbql(options: ListPullRequestsOptions): string | undefined {
	const parts: string[] = [];
	if (options.author) {
		parts.push(
			userFilterToBbql("author", options.author, options.currentUserUuid),
		);
	}
	if (options.reviewer) {
		parts.push(
			userFilterToBbql("reviewers", options.reviewer, options.currentUserUuid),
		);
	}
	return parts.length > 0 ? parts.join(" AND ") : undefined;
}

function userFilterToBbql(
	field: string,
	filter: UserFilter,
	meUuid: string | undefined,
): string {
	if (filter.kind === "me") {
		return `${field}.uuid="${meUuid}"`;
	}
	return `${field}.nickname="${escapeBbql(filter.value)}"`;
}

function escapeBbql(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export type CreatePullRequestInput = {
	title: string;
	description: string;
	sourceBranch: string;
	destinationBranch: string;
	draft?: boolean;
};

/**
 * POSTs a new pull request to Bitbucket. The source repo is implied by the
 * path (we only create PRs in the current repo, never from forks at this
 * stage). Reviewers are omitted: our Bitbucket workspaces auto-assign
 * reviewers based on code-owner settings.
 *
 * `draft: true` is only included in the body when explicitly set; we never
 * send `draft: false` so the server's default applies.
 */
export async function createPullRequest(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
	input: CreatePullRequestInput,
): Promise<PullRequestDetail> {
	const client = createBitbucketClient(credentials);
	const { data, response } = await client.POST(
		"/repositories/{workspace}/{repo_slug}/pullrequests",
		{
			params: {
				path: { workspace: ref.workspace, repo_slug: ref.slug },
			},
			body: {
				type: "pullrequest",
				title: input.title,
				description: input.description,
				source: { branch: { name: input.sourceBranch } },
				destination: { branch: { name: input.destinationBranch } },
				...(input.draft ? { draft: true } : {}),
			},
		},
	);

	if (!response.ok || !data) {
		throw new PullRequestError(
			`Failed to create pull request: HTTP ${response.status}.`,
			response.status,
		);
	}

	return toPullRequestDetail(data as RawPullRequest);
}

/**
 * Fetches a single pull request by id. Single typed call — the overlay
 * (BBC2-38) gives us typed path params and response shape, so we stay on
 * openapi-fetch's client rather than dropping to raw fetch.
 */
export async function getPullRequest(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
	id: number,
): Promise<PullRequestDetail> {
	const client = createBitbucketClient(credentials);
	const { data, response } = await client.GET(
		"/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}",
		{
			params: {
				path: {
					workspace: ref.workspace,
					repo_slug: ref.slug,
					pull_request_id: id,
				},
			},
		},
	);

	if (!response.ok || !data) {
		throw new PullRequestError(
			`Failed to fetch pull request #${id}: HTTP ${response.status}.`,
			response.status,
		);
	}

	return toPullRequestDetail(data as RawPullRequest);
}

/**
 * Finds the currently open pull request whose source branch matches the
 * given name, or returns null. BBQL `source.branch.name="..."` is a
 * single-call filter; `pagelen=1` caps the response to the first match.
 *
 * Scoped to OPEN intentionally: if a branch has merged/declined PRs, we
 * don't want to silently surface a stale one as "the PR for this branch."
 */
export async function findOpenPullRequestForBranch(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
	branch: string,
): Promise<PullRequest | null> {
	const client = createBitbucketClient(credentials);
	const { data, response } = await client.GET(
		"/repositories/{workspace}/{repo_slug}/pullrequests",
		{
			params: {
				path: { workspace: ref.workspace, repo_slug: ref.slug },
				query: {
					q: `state="OPEN" AND source.branch.name="${escapeBbql(branch)}"`,
					pagelen: 1,
					sort: "-updated_on",
				},
			},
		},
	);

	if (!response.ok || !data) {
		throw new PullRequestError(
			`Failed to search pull requests: HTTP ${response.status}.`,
			response.status,
		);
	}

	const first = data.values?.[0];
	return first ? toPullRequest(first as RawPullRequest) : null;
}

export type PullRequestCommentResult = {
	id: number;
	url: string;
};

/**
 * Posts a top-level comment on a pull request. `markup: "markdown"` is
 * explicit — the web UI defaults to it but the API's server-side default
 * isn't documented, so we send it to be safe. If a later smoke-test shows
 * the server already defaults to markdown we can drop the field.
 */
export async function createPullRequestComment(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
	pullRequestId: number,
	body: string,
): Promise<PullRequestCommentResult> {
	const client = createBitbucketClient(credentials);
	const { data, response } = await client.POST(
		"/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/comments",
		{
			params: {
				path: {
					workspace: ref.workspace,
					repo_slug: ref.slug,
					pull_request_id: pullRequestId,
				},
			},
			body: {
				type: "pullrequest_comment",
				content: { raw: body, markup: "markdown" },
			},
		},
	);

	if (!response.ok || !data) {
		throw new PullRequestError(
			`Failed to post comment on pull request #${pullRequestId}: HTTP ${response.status}.`,
			response.status,
		);
	}

	const raw = data as Record<string, any>;
	return {
		id: Number(raw.id ?? 0),
		url: String(raw.links?.html?.href ?? ""),
	};
}

function toPullRequestDetail(pr: RawPullRequest): PullRequestDetail {
	const base = toPullRequest(pr);
	const raw = pr as Record<string, any>;
	return {
		...base,
		description: String(raw.summary?.raw ?? raw.description ?? ""),
		sourceBranch: String(raw.source?.branch?.name ?? ""),
		destinationBranch: String(raw.destination?.branch?.name ?? ""),
		reviewers: toReviewers(raw.participants),
	};
}

function toReviewers(raw: unknown): Reviewer[] {
	if (!Array.isArray(raw)) return [];
	const out: Reviewer[] = [];
	for (const p of raw as RawParticipant[]) {
		const pp = p as Record<string, any>;
		if (pp.role !== "REVIEWER") continue;
		const account = toAuthor(pp.user);
		if (!account) continue;
		out.push({ account, state: toReviewState(pp.state) });
	}
	return out;
}

function toReviewState(raw: unknown): ReviewState {
	if (raw === "approved") return "approved";
	if (raw === "changes_requested") return "changes_requested";
	return "pending";
}
