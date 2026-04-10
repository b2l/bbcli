import { test, expect, describe } from "bun:test";
import { verifyCredentials, BitbucketAuthError } from "./index.ts";
import type { components } from "../../shared/bitbucket-http/generated";

type Account = components["schemas"]["account"];
type BitbucketError = components["schemas"]["error"];

/**
 * Canned-response fetch. verifyCredentials is tested for its behaviour on
 * different HTTP statuses — the URL + auth header concerns belong to the
 * shared bitbucket-http layer.
 *
 * Response bodies are typed against the generated schema so that drift in
 * Atlassian's OpenAPI spec breaks these tests at compile time instead of
 * silently masking real bugs.
 */
function mockFetch(status: number, body: unknown = {}): typeof fetch {
  const impl = async (): Promise<Response> =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  return impl as unknown as typeof fetch;
}

describe("verifyCredentials", () => {
  test("returns the account on HTTP 200", async () => {
    const account: Account = {
      type: "account",
      display_name: "Alice Example",
      uuid: "{abc-123}",
    };
    const user = await verifyCredentials(
      { email: "a@b.co", token: "t" },
      mockFetch(200, account),
    );
    expect(user).toMatchObject(account);
  });

  test("throws BitbucketAuthError with status 401 on HTTP 401", async () => {
    const body: BitbucketError = {
      type: "error",
      error: { message: "Bad credentials" },
    };
    const err = await verifyCredentials(
      { email: "a@b.co", token: "bad" },
      mockFetch(401, body),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(BitbucketAuthError);
    expect((err as BitbucketAuthError).status).toBe(401);
    expect((err as BitbucketAuthError).message).toContain("rejected");
  });

  test("throws BitbucketAuthError with status 403 on HTTP 403", async () => {
    const body: BitbucketError = {
      type: "error",
      error: { message: "Insufficient scopes" },
    };
    const err = await verifyCredentials(
      { email: "a@b.co", token: "bad" },
      mockFetch(403, body),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(BitbucketAuthError);
    expect((err as BitbucketAuthError).status).toBe(403);
    expect((err as BitbucketAuthError).message).toContain("account:read");
  });

  test("throws BitbucketAuthError on unexpected HTTP 500", async () => {
    const body: BitbucketError = {
      type: "error",
      error: { message: "Internal server error" },
    };
    const err = await verifyCredentials(
      { email: "a@b.co", token: "t" },
      mockFetch(500, body),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(BitbucketAuthError);
    expect((err as BitbucketAuthError).status).toBe(500);
    expect((err as BitbucketAuthError).message).toContain("500");
  });

  test("propagates network errors from fetch", async () => {
    const boom = new Error("network down");
    const f = (async () => {
      throw boom;
    }) as unknown as typeof fetch;
    const err = await verifyCredentials(
      { email: "a@b.co", token: "t" },
      f,
    ).catch((e) => e);
    expect(err).toBe(boom);
  });
});
