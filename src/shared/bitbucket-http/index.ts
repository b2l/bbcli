import createClient, { type Client } from "openapi-fetch";
import type { paths } from "./generated";

export type BitbucketClient = Client<paths>;

export type Credentials = {
  email: string;
  token: string;
};

const BASE_URL = "https://api.bitbucket.org/2.0";

/**
 * Builds a typed Bitbucket Cloud API client with HTTP Basic auth baked in.
 * The `fetchImpl` override exists so tests can inject a mock; production
 * code should pass nothing and get the global `fetch`.
 */
export function createBitbucketClient(
  credentials: Credentials,
  fetchImpl: typeof fetch = fetch,
): BitbucketClient {
  const basic = btoa(`${credentials.email}:${credentials.token}`);
  return createClient<paths>({
    baseUrl: BASE_URL,
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
    },
    fetch: fetchImpl,
  });
}
