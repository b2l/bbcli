import {
  createBitbucketClient,
  type Credentials,
} from "../../shared/bitbucket-http/index.ts";
import type { components } from "../../shared/bitbucket-http/generated";

export type BitbucketAccount = components["schemas"]["account"];

export class BitbucketAuthError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "BitbucketAuthError";
    this.status = status;
  }
}

/**
 * Asks Bitbucket whether the given credentials work by hitting GET /user.
 * Returns the current account on success, throws BitbucketAuthError on any
 * non-2xx response with a message suitable for direct user display.
 */
export async function verifyCredentials(
  credentials: Credentials,
  fetchImpl: typeof fetch = fetch,
): Promise<BitbucketAccount> {
  const client = createBitbucketClient(credentials, fetchImpl);
  const { data, response } = await client.GET("/user");

  if (response.status === 401) {
    throw new BitbucketAuthError(
      "Bitbucket rejected the credentials (HTTP 401). Check the email and API token.",
      401,
    );
  }
  if (response.status === 403) {
    throw new BitbucketAuthError(
      "Bitbucket returned HTTP 403. The API token may be missing the `account:read` scope.",
      403,
    );
  }
  if (!response.ok || !data) {
    throw new BitbucketAuthError(
      `Unexpected response from Bitbucket: HTTP ${response.status}.`,
      response.status,
    );
  }
  return data;
}
