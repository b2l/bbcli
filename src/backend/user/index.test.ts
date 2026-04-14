import { test, expect, describe } from "bun:test";
import { getCurrentUser, UserError } from "./index.ts";

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

describe("getCurrentUser", () => {
  test("returns uuid and display name", async () => {
    const f = mockFetch({
      "/user": {
        status: 200,
        body: { uuid: "{abc-123}", display_name: "Alice" },
      },
    });

    const result = await getCurrentUser(creds, f);
    expect(result).toEqual({ uuid: "{abc-123}", displayName: "Alice" });
  });

  test("falls back to empty display name when absent", async () => {
    const f = mockFetch({
      "/user": { status: 200, body: { uuid: "{abc-123}" } },
    });

    const result = await getCurrentUser(creds, f);
    expect(result.displayName).toBe("");
  });

  test("throws UserError on failure", async () => {
    const f = mockFetch({
      "/user": { status: 401, body: { type: "error" } },
    });

    const err = await getCurrentUser(creds, f).catch((e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as UserError).status).toBe(401);
  });
});
