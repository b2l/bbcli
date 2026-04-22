import type { components } from "../../shared/bitbucket-http/generated";
import {
	BASE_URL,
	basicAuthHeader,
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

/**
 * Merge strategies recognized by Bitbucket on `POST /pullrequests/{id}/merge`.
 * Mirrors the `pullrequest_merge_parameters.merge_strategy` enum (generated
 * schema). The list *allowed* on any given destination branch is a subset
 * exposed as `PullRequestDetail.allowedMergeStrategies`.
 */
export const MERGE_STRATEGIES = [
	"merge_commit",
	"squash",
	"fast_forward",
	"squash_fast_forward",
	"rebase_fast_forward",
	"rebase_merge",
] as const;
export type MergeStrategy = (typeof MERGE_STRATEGIES)[number];

export function isMergeStrategy(value: string): value is MergeStrategy {
	return (MERGE_STRATEGIES as readonly string[]).includes(value);
}

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

/**
 * A non-reviewer participant on a PR. State is populated when the person
 * has approved or requested changes without being on the formal reviewer
 * list (e.g. someone approving a Snyk auto-PR with no assigned reviewers).
 * Pure commenters appear with state="pending".
 */
export type Participant = {
	account: PullRequestAuthor;
	state: ReviewState;
};

export type PullRequestDetail = PullRequest & {
	description: string;
	sourceBranch: string;
	destinationBranch: string;
	/**
	 * The destination branch's configured default merge strategy, or null
	 * when the branch has no default set (Bitbucket's own fallback is
	 * `"merge_commit"`). Only populated when the fetch explicitly requests
	 * `fields=+destination.branch.default_merge_strategy`.
	 */
	defaultMergeStrategy: MergeStrategy | null;
	/**
	 * Strategies the destination branch permits on merge. Empty array when
	 * the branch has no restrictions configured (in which case the server
	 * allows all). Only populated when the fetch explicitly requests
	 * `fields=+destination.branch.merge_strategies`.
	 */
	allowedMergeStrategies: MergeStrategy[];
	reviewers: Reviewer[];
	participants: Participant[];
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
	/**
	 * UUIDs (curly-brace form) to send as reviewers. The caller is responsible
	 * for resolving + filtering them (e.g. removing the author, deduping). We
	 * pass them through verbatim.
	 */
	reviewerUuids?: string[];
};

/**
 * POSTs a new pull request to Bitbucket. The source repo is implied by the
 * path (we only create PRs in the current repo, never from forks at this
 * stage).
 *
 * `draft: true` is only included in the body when explicitly set; we never
 * send `draft: false` so the server's default applies.
 *
 * `reviewers` is only included when `reviewerUuids` is non-empty — sending
 * an empty array is legal but noisy.
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
				...(input.reviewerUuids && input.reviewerUuids.length > 0
					? {
							reviewers: input.reviewerUuids.map((uuid) => ({
								type: "account" as const,
								uuid,
							})),
						}
					: {}),
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
 * Fields the default serialization omits, requested additively via Bitbucket's
 * `fields=+foo,+bar` mechanism. Both live on `destination.branch` and are
 * required for `bb pr merge` — the default strategy and the client-side
 * strategy validation list. See docs/bb-notes.md → "Default merge strategy".
 *
 * Adding to the default response (rather than dropping fields) means
 * existing consumers of this function are unaffected.
 */
const PR_EXTRA_FIELDS = [
	"+destination.branch.default_merge_strategy",
	"+destination.branch.merge_strategies",
].join(",");

/**
 * Fetches a single pull request by id. Augments the default response with
 * merge-strategy fields via `fields=+...` — the typed path params stay
 * intact; only the query params need a local `as any` because openapi-fetch's
 * generated types declare `query?: never` for this endpoint (see
 * docs/bb-notes.md → "Gotcha: `fields` is not declared in the OpenAPI spec").
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
				// `fields` isn't in the generated types for this endpoint; see
				// docs/bb-notes.md → "Gotcha: `fields` is not declared in the
				// OpenAPI spec". Cast to loosen the typed contract just here.
				query: { fields: PR_EXTRA_FIELDS } as unknown as undefined,
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

/**
 * Returns the UUIDs (curly-brace form) of the reviewers configured as defaults
 * on the destination repo, including those inherited from the project. This
 * matches what the Bitbucket UI shows under Repository settings → Default
 * reviewers.
 *
 * Single page of pagelen=100 — real-world default-reviewer lists are tiny
 * (<10). If anyone ever configures more we'll add pagination.
 *
 * Entries without a uuid are skipped silently. We surface a non-2xx as a
 * PullRequestError; the caller MUST propagate it rather than silently
 * creating a reviewerless PR.
 */
export async function listEffectiveDefaultReviewers(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
): Promise<string[]> {
	const client = createBitbucketClient(credentials);
	const { data, response } = await client.GET(
		"/repositories/{workspace}/{repo_slug}/effective-default-reviewers",
		{
			params: {
				path: { workspace: ref.workspace, repo_slug: ref.slug },
			},
		},
	);

	if (!response.ok || !data) {
		throw new PullRequestError(
			`Failed to fetch effective default reviewers: HTTP ${response.status}.`,
			response.status,
		);
	}

	const values = (data as { values?: Array<{ user?: { uuid?: string } }> })
		.values;
	if (!values) return [];

	const uuids: string[] = [];
	for (const entry of values) {
		const uuid = entry.user?.uuid;
		if (typeof uuid === "string" && uuid.length > 0) uuids.push(uuid);
	}
	return uuids;
}

/**
 * Returns the raw unified-diff text for a PR. Bypasses the typed openapi-fetch
 * client because `GET /pullrequests/{id}/diff` returns a 302 redirect to
 * `/repositories/{ws}/{slug}/diff/{spec}` which serves `text/plain`, not JSON
 * (see docs/bb-notes.md → PR diff). Content is returned as a string — the
 * API's actual encoding is "whatever the files use" and we pass it through
 * verbatim.
 */
export async function getPullRequestDiff(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
	pullRequestId: number,
): Promise<string> {
	const url = `${BASE_URL}/repositories/${encodeURIComponent(ref.workspace)}/${encodeURIComponent(ref.slug)}/pullrequests/${pullRequestId}/diff`;
	const response = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: basicAuthHeader(credentials),
			// Don't request application/json — the target serves text/plain.
			Accept: "text/plain",
		},
		// `fetch` follows the 302 automatically.
		redirect: "follow",
	});

	if (!response.ok) {
		throw new PullRequestError(
			`Failed to fetch diff for pull request #${pullRequestId}: HTTP ${response.status}.`,
			response.status,
		);
	}

	return await response.text();
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

/**
 * Records the authenticated user's review state on a PR. Approve and
 * request-changes are two independent states; they map to symmetric
 * POST/DELETE pairs on `/approve` and `/request-changes`.
 *
 * Idempotency is NOT documented by Bitbucket for any of these endpoints.
 * We let non-2xx errors propagate; callers who need "re-running is a
 * no-op" semantics should handle expected errors (e.g. a 409 conflict on
 * re-approval) themselves. Smoke-test to find the actual behavior.
 *
 * `DELETE /approve` is documented to return `400` when the PR has already
 * been merged — surface that at the command layer.
 */
async function postParticipantAction(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
	pullRequestId: number,
	action: "approve" | "request-changes",
): Promise<void> {
	const client = createBitbucketClient(credentials);
	const { response } =
		action === "approve"
			? await client.POST(
					"/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/approve",
					{
						params: {
							path: {
								workspace: ref.workspace,
								repo_slug: ref.slug,
								pull_request_id: pullRequestId,
							},
						},
					},
				)
			: await client.POST(
					"/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/request-changes",
					{
						params: {
							path: {
								workspace: ref.workspace,
								repo_slug: ref.slug,
								pull_request_id: pullRequestId,
							},
						},
					},
				);

	if (!response.ok) {
		throw new PullRequestError(
			`Failed to ${action} pull request #${pullRequestId}: HTTP ${response.status}.`,
			response.status,
		);
	}
}

async function deleteParticipantAction(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
	pullRequestId: number,
	action: "approve" | "request-changes",
): Promise<void> {
	const client = createBitbucketClient(credentials);
	const { response } =
		action === "approve"
			? await client.DELETE(
					"/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/approve",
					{
						params: {
							path: {
								workspace: ref.workspace,
								repo_slug: ref.slug,
								pull_request_id: pullRequestId,
							},
						},
					},
				)
			: await client.DELETE(
					"/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/request-changes",
					{
						params: {
							path: {
								workspace: ref.workspace,
								repo_slug: ref.slug,
								pull_request_id: pullRequestId,
							},
						},
					},
				);

	if (!response.ok) {
		throw new PullRequestError(
			`Failed to withdraw ${action} on pull request #${pullRequestId}: HTTP ${response.status}.`,
			response.status,
		);
	}
}

export async function approvePullRequest(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
	pullRequestId: number,
): Promise<void> {
	await postParticipantAction(credentials, ref, pullRequestId, "approve");
}

export async function unapprovePullRequest(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
	pullRequestId: number,
): Promise<void> {
	await deleteParticipantAction(credentials, ref, pullRequestId, "approve");
}

export async function requestChangesOnPullRequest(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
	pullRequestId: number,
): Promise<void> {
	await postParticipantAction(
		credentials,
		ref,
		pullRequestId,
		"request-changes",
	);
}

export async function withdrawRequestChanges(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
	pullRequestId: number,
): Promise<void> {
	await deleteParticipantAction(
		credentials,
		ref,
		pullRequestId,
		"request-changes",
	);
}

export type MergeInput = {
	mergeStrategy: MergeStrategy;
	/** Free-form merge commit message. Ignored by `fast_forward`. Max 128 KiB. */
	message?: string;
	/**
	 * Server-side branch cleanup. When true, Bitbucket deletes the source
	 * branch from the remote after the merge lands. Local-side cleanup is
	 * the command layer's responsibility.
	 */
	closeSourceBranch?: boolean;
};

/**
 * Outcome of the sync merge POST. The server returns:
 *   200 → merge complete, body is the updated PR (mapped to `{kind:"done"}`).
 *   202 → merge running async (either because it exceeded the sync timeout
 *         or the caller opted in). The `Location` header carries the
 *         task-status polling URL (mapped to `{kind:"async"}`).
 *
 * 4xx/5xx/555 propagate as `PullRequestError` — callers map them to user
 * messages (409 "refs changed, retry", 555 "timed out, retry", etc.).
 */
export type MergeResult =
	| { kind: "done"; pr: PullRequestDetail }
	| { kind: "async"; taskUrl: string };

export async function mergePullRequest(
	credentials: Credentials,
	ref: { workspace: string; slug: string },
	pullRequestId: number,
	input: MergeInput,
): Promise<MergeResult> {
	const client = createBitbucketClient(credentials);
	const { data, response } = await client.POST(
		"/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/merge",
		{
			params: {
				path: {
					workspace: ref.workspace,
					repo_slug: ref.slug,
					pull_request_id: pullRequestId,
				},
			},
			body: {
				type: "pullrequest_merge_parameters",
				merge_strategy: input.mergeStrategy,
				...(input.message !== undefined ? { message: input.message } : {}),
				...(input.closeSourceBranch !== undefined
					? { close_source_branch: input.closeSourceBranch }
					: {}),
			},
		},
	);

	if (response.status === 202) {
		const location = response.headers.get("location");
		if (!location) {
			throw new PullRequestError(
				`Merge of pull request #${pullRequestId} returned 202 with no Location header — cannot poll.`,
				202,
			);
		}
		return { kind: "async", taskUrl: location };
	}

	if (!response.ok || !data) {
		throw new PullRequestError(
			mergeErrorMessage(pullRequestId, response.status),
			response.status,
		);
	}

	return { kind: "done", pr: toPullRequestDetail(data as RawPullRequest) };
}

function mergeErrorMessage(pullRequestId: number, status: number): string {
	switch (status) {
		case 409:
			return `Failed to merge pull request #${pullRequestId}: refs changed mid-merge (HTTP 409). Re-run after fetching the latest state.`;
		case 555:
			return `Merge of pull request #${pullRequestId} timed out server-side (HTTP 555). Re-run after giving it a moment.`;
		default:
			return `Failed to merge pull request #${pullRequestId}: HTTP ${status}.`;
	}
}

export type MergeTaskStatus =
	| { status: "PENDING" }
	| { status: "SUCCESS"; pr: PullRequestDetail }
	| { status: "FAILED"; error: string };

/**
 * Polls a single merge-task-status URL (the one from the 202 Location
 * header). Uses raw fetch because the 202 URL is opaque (built by the
 * server; openapi-fetch can't route it as a typed endpoint).
 */
export async function getMergeTaskStatus(
	credentials: Credentials,
	taskUrl: string,
): Promise<MergeTaskStatus> {
	const response = await fetch(taskUrl, {
		method: "GET",
		headers: {
			Authorization: basicAuthHeader(credentials),
			Accept: "application/json",
		},
	});

	if (!response.ok) {
		throw new PullRequestError(
			`Failed to poll merge task: HTTP ${response.status}.`,
			response.status,
		);
	}

	const raw = (await response.json()) as Record<string, any>;
	const status = String(raw.task_status ?? "");
	if (status === "SUCCESS") {
		const mergeResult = raw.merge_result as RawPullRequest | undefined;
		if (!mergeResult) {
			throw new PullRequestError(
				"Merge task reported SUCCESS but returned no merge_result.",
			);
		}
		return { status: "SUCCESS", pr: toPullRequestDetail(mergeResult) };
	}
	if (status === "PENDING") return { status: "PENDING" };
	// Anything else (typically FAILED / ERROR) surfaces the server's error
	// message verbatim. Bitbucket's shape: { type: "error", error: { message } }.
	const message =
		typeof raw.error?.message === "string"
			? raw.error.message
			: `Merge task reported '${status}'.`;
	return { status: "FAILED", error: message };
}

function toPullRequestDetail(pr: RawPullRequest): PullRequestDetail {
	const base = toPullRequest(pr);
	const raw = pr as Record<string, any>;
	return {
		...base,
		description: String(raw.summary?.raw ?? raw.description ?? ""),
		sourceBranch: String(raw.source?.branch?.name ?? ""),
		destinationBranch: String(raw.destination?.branch?.name ?? ""),
		defaultMergeStrategy: toMergeStrategyOrNull(
			raw.destination?.branch?.default_merge_strategy,
		),
		allowedMergeStrategies: toMergeStrategyList(
			raw.destination?.branch?.merge_strategies,
		),
		reviewers: toReviewers(raw.participants),
		participants: toParticipants(raw.participants),
	};
}

function toMergeStrategyOrNull(raw: unknown): MergeStrategy | null {
	if (typeof raw !== "string" || !raw) return null;
	return isMergeStrategy(raw) ? raw : null;
}

function toMergeStrategyList(raw: unknown): MergeStrategy[] {
	if (!Array.isArray(raw)) return [];
	const out: MergeStrategy[] = [];
	for (const entry of raw) {
		if (typeof entry === "string" && isMergeStrategy(entry)) out.push(entry);
	}
	return out;
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

function toParticipants(raw: unknown): Participant[] {
	if (!Array.isArray(raw)) return [];
	const out: Participant[] = [];
	for (const p of raw as RawParticipant[]) {
		const pp = p as Record<string, any>;
		if (pp.role !== "PARTICIPANT") continue;
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
