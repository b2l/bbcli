import {
  BASE_URL,
  basicAuthHeader,
  type Credentials,
} from "./index.ts";

/**
 * Shape Bitbucket returns for every paginated list endpoint. Generic over
 * the item type so callers keep type safety on `values`.
 */
export type PaginatedResponse<T> = {
  values?: T[];
  next?: string;
};

/**
 * Minimum shape we need from the caller's first call — matches openapi-fetch's
 * `{ data?, error?, response }` return structurally. Callers pass
 * `() => client.GET(...)` directly; T is inferred from the GET's response.
 */
type FirstCallResult<T> = {
  data?: PaginatedResponse<T>;
  response: Response;
};

export class PaginationError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "PaginationError";
    this.status = status;
  }
}

const ALLOWED_ORIGIN = new URL(BASE_URL).origin;

/**
 * Wraps a typed openapi-fetch first call with Bitbucket cursor-based
 * pagination. The caller keeps full type inference on path, query, and
 * response shape; `withPagination` only deals with "did we get enough items
 * yet? if not, follow `next` until we do."
 *
 *     const prs = await withPagination(
 *       () => client.GET("/repositories/{workspace}/{repo_slug}/pullrequests", {
 *         params: { path: pathParams, query },
 *       }),
 *       credentials,
 *       { limit: 30 },
 *     );
 *
 * Subsequent pages can't go through the typed client (cursors are opaque
 * URLs, not templated paths), so they use raw fetch with the same auth.
 * Defense in depth: refuses to follow a `next` URL whose origin isn't
 * Bitbucket's API host.
 */
export async function withPagination<T>(
  firstCall: () => Promise<FirstCallResult<T>>,
  credentials: Credentials,
  opts: { limit: number },
): Promise<T[]> {
  const { data, response } = await firstCall();

  if (!response.ok || !data) {
    throw new PaginationError(
      `Failed to fetch first page: HTTP ${response.status}.`,
      response.status,
    );
  }

  const taken = (data.values ?? []).slice(0, opts.limit);

  if (taken.length < opts.limit && data.next) {
    const rest = await followCursor<T>(
      data.next,
      credentials,
      { limit: opts.limit - taken.length },
    );
    return [...taken, ...rest];
  }
  return taken;
}

async function followCursor<T>(
  url: string,
  credentials: Credentials,
  opts: { limit: number },
): Promise<T[]> {
  if (new URL(url).origin !== ALLOWED_ORIGIN) {
    throw new PaginationError(
      `Refusing to follow next URL outside ${ALLOWED_ORIGIN}: ${url}`,
    );
  }

  const response = await fetch(url, {
    headers: {
      Authorization: basicAuthHeader(credentials),
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new PaginationError(
      `Failed to fetch next page: HTTP ${response.status}.`,
      response.status,
    );
  }

  const page = (await response.json()) as PaginatedResponse<T>;
  const taken = (page.values ?? []).slice(0, opts.limit);

  if (taken.length < opts.limit && page.next) {
    const rest = await followCursor<T>(
      page.next,
      credentials,
      { limit: opts.limit - taken.length },
    );
    return [...taken, ...rest];
  }
  return taken;
}
