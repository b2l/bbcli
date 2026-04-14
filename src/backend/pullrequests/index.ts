import {
  BASE_URL,
  type Credentials,
} from "../../shared/bitbucket-http/index.ts";
import {
  paginate,
  PaginationError,
} from "../../shared/bitbucket-http/paginate.ts";
import type { components } from "../../shared/bitbucket-http/generated";

type RawPullRequest = components["schemas"]["pullrequest"];

export type PullRequestStateFilter = "open" | "merged" | "declined" | "all";

export type PullRequestApiState =
  | "OPEN"
  | "MERGED"
  | "DECLINED"
  | "SUPERSEDED";

export type UserFilter =
  | { kind: "me" }
  | { kind: "nickname"; value: string };

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
  fetchImpl: typeof fetch = fetch,
): Promise<PullRequest[]> {
  const url = new URL(
    `${BASE_URL}/repositories/${encodeURIComponent(ref.workspace)}/${encodeURIComponent(ref.slug)}/pullrequests`,
  );
  url.searchParams.set("sort", "-updated_on");
  url.searchParams.set("pagelen", String(PAGELEN));

  const states = STATE_MAP[options.state];
  const filterBbql = buildBbql(options);
  if (filterBbql) {
    // Bitbucket ignores the `state=` query param when `q` is also set, so
    // the state filter must live inside the BBQL expression instead.
    url.searchParams.set("q", `${stateBbql(states)} AND ${filterBbql}`);
  } else {
    for (const s of states) url.searchParams.append("state", s);
  }

  try {
    const raw = await paginate<RawPullRequest>(
      url.toString(),
      credentials,
      { limit: options.limit },
      fetchImpl,
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
  const uuid = typeof a["uuid"] === "string" ? a["uuid"] : "";
  if (!uuid) return null;
  return {
    uuid,
    displayName: typeof a["display_name"] === "string" ? a["display_name"] : "",
    nickname: typeof a["nickname"] === "string" ? a["nickname"] : "",
  };
}

function stateBbql(states: PullRequestApiState[]): string {
  if (states.length === 1) return `state="${states[0]}"`;
  return `(${states.map((s) => `state="${s}"`).join(" OR ")})`;
}

function buildBbql(options: ListPullRequestsOptions): string | undefined {
  const parts: string[] = [];
  if (options.author) {
    parts.push(userFilterToBbql("author", options.author, options.currentUserUuid));
  }
  if (options.reviewer) {
    parts.push(userFilterToBbql("reviewers", options.reviewer, options.currentUserUuid));
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
