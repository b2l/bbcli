import createClient, { type Client } from "openapi-fetch";
import type { paths } from "./generated";

export type BitbucketClient = Client<paths>;

export type Credentials = {
  email: string;
  token: string;
};

export const BASE_URL = "https://api.bitbucket.org/2.0";

/**
 * Builds the value for the `Authorization` HTTP header. Exposed so callers
 * that bypass the typed client (e.g. cursor-based pagination, which has to
 * follow opaque `next` URLs) can attach the same auth.
 */
export function basicAuthHeader(credentials: Credentials): string {
  return `Basic ${btoa(`${credentials.email}:${credentials.token}`)}`;
}

/**
 * Builds a typed Bitbucket Cloud API client with HTTP Basic auth baked in.
 * Tests intercept the global `fetch` via msw; no injection seam needed.
 */
export function createBitbucketClient(
  credentials: Credentials,
): BitbucketClient {
  return createClient<paths>({
    baseUrl: BASE_URL,
    headers: {
      Authorization: basicAuthHeader(credentials),
      Accept: "application/json",
    },
  });
}
