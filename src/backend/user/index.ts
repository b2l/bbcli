import {
  createBitbucketClient,
  type Credentials,
} from "../../shared/bitbucket-http/index.ts";

export type CurrentUser = {
  uuid: string;
  displayName: string;
};

export class UserError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "UserError";
    this.status = status;
  }
}

/**
 * Fetches the authenticated user. Used to expand `@me` filters into a
 * stable identifier (uuid) for BBQL queries.
 */
export async function getCurrentUser(
  credentials: Credentials,
  fetchImpl: typeof fetch = fetch,
): Promise<CurrentUser> {
  const client = createBitbucketClient(credentials, fetchImpl);

  const { data, response } = await client.GET("/user");

  if (!response.ok || !data || !data.uuid) {
    throw new UserError(
      `Failed to fetch current user: HTTP ${response.status}.`,
      response.status,
    );
  }

  return {
    uuid: data.uuid,
    displayName: data.display_name ?? "",
  };
}
