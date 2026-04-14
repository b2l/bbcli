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
 * Collects items from a Bitbucket paginated endpoint, up to `opts.limit`.
 *
 * Fetches the given URL, takes items from the response, and — if more are
 * wanted and the response advertises a `next` cursor — recurses on that
 * cursor URL. Every call (including the first) does the same thing.
 *
 * Defense in depth: refuses to follow a URL whose origin isn't Bitbucket's
 * API host, in case a malicious or buggy upstream tries to redirect us with
 * auth attached. Applies to the caller's initial URL too.
 */
export async function paginate<T>(
  url: string,
  credentials: Credentials,
  opts: { limit: number },
  fetchImpl: typeof fetch = fetch,
): Promise<T[]> {
  if (new URL(url).origin !== ALLOWED_ORIGIN) {
    throw new PaginationError(
      `Refusing to fetch outside ${ALLOWED_ORIGIN}: ${url}`,
    );
  }

  const response = await fetchImpl(url, {
    headers: {
      Authorization: basicAuthHeader(credentials),
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new PaginationError(
      `Failed to fetch page: HTTP ${response.status}.`,
      response.status,
    );
  }

  const page = (await response.json()) as PaginatedResponse<T>;
  const taken = (page.values ?? []).slice(0, opts.limit);

  if (taken.length < opts.limit && page.next) {
    const rest = await paginate<T>(
      page.next,
      credentials,
      { limit: opts.limit - taken.length },
      fetchImpl,
    );
    return [...taken, ...rest];
  }
  return taken;
}
