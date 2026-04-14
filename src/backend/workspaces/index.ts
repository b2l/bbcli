import {
  createBitbucketClient,
  type Credentials,
} from "../../shared/bitbucket-http/index.ts";

export type WorkspaceInfo = {
  slug: string;
  administrator: boolean;
};

export class WorkspaceError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "WorkspaceError";
    this.status = status;
  }
}

/**
 * Lists workspaces the authenticated user has access to.
 * Fetches a single page of up to 100 results (the Bitbucket API max).
 */
export async function listWorkspaces(
  credentials: Credentials,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkspaceInfo[]> {
  const client = createBitbucketClient(credentials, fetchImpl);

  const { data, response } = await client.GET("/user/workspaces", {
    params: { query: { pagelen: 100 } },
  });

  if (!response.ok || !data) {
    throw new WorkspaceError(
      `Failed to list workspaces: HTTP ${response.status}.`,
      response.status,
    );
  }

  return data.values?.map(value => ({
    slug: value.workspace?.slug ?? "",
    administrator: value.administrator ?? false,
  })) ?? []
}
