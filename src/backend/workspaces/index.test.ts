import { test, expect, describe } from "bun:test";
import { listWorkspaces, WorkspaceError } from "./index.ts";

/**
 * openapi-fetch passes a Request object, so we pull the URL from it.
 */
function mockFetch(
  routes: Record<string, { status: number; body: unknown }>,
): typeof fetch {
  return (async (input: Request) => {
    const { pathname } = new URL(input.url);
    const key = pathname.replace("/2.0", "");
    const route = routes[key];
    if (!route) throw new Error(`Unexpected request: ${key}`);
    return new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const creds = { email: "a@b.co", token: "t" };

describe("listWorkspaces", () => {
  test("returns workspaces with slug and admin flag", async () => {
    const f = mockFetch({
      "/user/workspaces": {
        status: 200,
        body: {
          values: [
            { workspace: { slug: "team-a", uuid: "{aaa}" }, administrator: true },
            { workspace: { slug: "team-b", uuid: "{bbb}" }, administrator: false },
          ],
        },
      },
    });

    const result = await listWorkspaces(creds, f);
    expect(result).toEqual([
      { slug: "team-a", administrator: true },
      { slug: "team-b", administrator: false },
    ]);
  });

  test("returns empty array when user has no workspaces", async () => {
    const f = mockFetch({
      "/user/workspaces": { status: 200, body: { values: [] } },
    });

    const result = await listWorkspaces(creds, f);
    expect(result).toEqual([]);
  });

  test("throws WorkspaceError on failure", async () => {
    const f = mockFetch({
      "/user/workspaces": { status: 401, body: { type: "error" } },
    });

    const err = await listWorkspaces(creds, f).catch((e) => e);
    expect(err).toBeInstanceOf(WorkspaceError);
    expect((err as WorkspaceError).status).toBe(401);
  });

});
