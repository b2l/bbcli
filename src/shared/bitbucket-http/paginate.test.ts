import { test, expect, describe } from "bun:test";
import { paginate, PaginationError } from "./paginate.ts";

const creds = { email: "a@b.co", token: "t" };

type Item = { id: number };

const BASE =
  "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests";
const PAGE_1 = `${BASE}?page=1`;
const PAGE_2 = `${BASE}?page=2`;
const PAGE_3 = `${BASE}?page=3`;

type FetchCall = { url: string; init: RequestInit | undefined };

function mockFetch(
  responder: (url: string) => { status: number; body: unknown },
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const { status, body } = responder(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

function page(ids: number[], next?: string): { values: Item[]; next?: string } {
  return { values: ids.map((id) => ({ id })), ...(next ? { next } : {}) };
}

describe("paginate", () => {
  test("returns items from a single page when no `next`", async () => {
    const { fetch } = mockFetch(() => ({ status: 200, body: page([1, 2, 3]) }));
    const result = await paginate<Item>(PAGE_1, creds, { limit: 100 }, fetch);
    expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  test("truncates a page when `limit` is smaller", async () => {
    const { fetch } = mockFetch(() => ({
      status: 200,
      body: page([1, 2, 3, 4, 5]),
    }));
    const result = await paginate<Item>(PAGE_1, creds, { limit: 2 }, fetch);
    expect(result.map((r) => r.id)).toEqual([1, 2]);
  });

  test("follows `next` cursor and concatenates pages", async () => {
    const { fetch, calls } = mockFetch((url) => {
      if (url === PAGE_1) return { status: 200, body: page([1, 2], PAGE_2) };
      if (url === PAGE_2) return { status: 200, body: page([3, 4], PAGE_3) };
      if (url === PAGE_3) return { status: 200, body: page([5]) };
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await paginate<Item>(PAGE_1, creds, { limit: 100 }, fetch);

    expect(result.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(calls.map((c) => c.url)).toEqual([PAGE_1, PAGE_2, PAGE_3]);
  });

  test("stops fetching once limit is reached mid-page", async () => {
    const { fetch, calls } = mockFetch((url) => {
      if (url === PAGE_1) return { status: 200, body: page([1, 2], PAGE_2) };
      if (url === PAGE_2) return { status: 200, body: page([3, 4, 5], PAGE_3) };
      throw new Error(`Should not have requested ${url}`);
    });

    const result = await paginate<Item>(PAGE_1, creds, { limit: 4 }, fetch);

    expect(result.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(calls.map((c) => c.url)).toEqual([PAGE_1, PAGE_2]);
  });

  test("attaches Basic auth on every request (including the first)", async () => {
    const { fetch, calls } = mockFetch(() => ({
      status: 200,
      body: page([1]),
    }));

    await paginate<Item>(PAGE_1, creds, { limit: 100 }, fetch);

    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Basic " + btoa("a@b.co:t"));
    expect(headers["Accept"]).toBe("application/json");
  });

  test("refuses to fetch a URL outside the Bitbucket API origin", async () => {
    const { fetch } = mockFetch(() => {
      throw new Error("fetchImpl should not be invoked");
    });

    const err = await paginate<Item>(
      "https://evil.example.com/2.0/foo",
      creds,
      { limit: 100 },
      fetch,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(PaginationError);
    expect((err as Error).message).toContain("evil.example.com");
  });

  test("refuses to follow a cross-origin `next` URL", async () => {
    const { fetch } = mockFetch((url) => {
      if (url === PAGE_1) {
        return { status: 200, body: page([1], "https://evil.example.com/foo") };
      }
      throw new Error(`Should not have requested ${url}`);
    });

    const err = await paginate<Item>(PAGE_1, creds, { limit: 100 }, fetch)
      .catch((e) => e);

    expect(err).toBeInstanceOf(PaginationError);
    expect((err as Error).message).toContain("evil.example.com");
  });

  test("throws PaginationError on HTTP failure", async () => {
    const { fetch } = mockFetch(() => ({ status: 500, body: { type: "error" } }));

    const err = await paginate<Item>(PAGE_1, creds, { limit: 100 }, fetch)
      .catch((e) => e);

    expect(err).toBeInstanceOf(PaginationError);
    expect((err as PaginationError).status).toBe(500);
  });

  test("handles a missing `values` array as empty", async () => {
    const { fetch } = mockFetch(() => ({ status: 200, body: {} }));
    const result = await paginate<Item>(PAGE_1, creds, { limit: 100 }, fetch);
    expect(result).toEqual([]);
  });
});
