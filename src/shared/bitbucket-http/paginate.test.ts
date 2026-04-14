import { test, expect, describe } from "bun:test";
import { http, HttpResponse } from "msw";
import { paginate, PaginationError } from "./paginate.ts";
import { BITBUCKET_BASE, server, setupMsw } from "../../test/msw/server.ts";

setupMsw();

const creds = { email: "a@b.co", token: "t" };

type Item = { id: number };

const BASE_PATH = `${BITBUCKET_BASE}/repositories/ws/repo/pullrequests`;
const PAGE_1 = `${BASE_PATH}?page=1`;
const PAGE_2 = `${BASE_PATH}?page=2`;
const PAGE_3 = `${BASE_PATH}?page=3`;

function page(ids: number[], next?: string): { values: Item[]; next?: string } {
  return { values: ids.map((id) => ({ id })), ...(next ? { next } : {}) };
}

describe("paginate", () => {
  test("returns items from a single page when no `next`", async () => {
    server.use(
      http.get(BASE_PATH, () => HttpResponse.json(page([1, 2, 3]))),
    );

    const result = await paginate<Item>(PAGE_1, creds, { limit: 100 });
    expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  test("truncates a page when `limit` is smaller", async () => {
    server.use(
      http.get(BASE_PATH, () => HttpResponse.json(page([1, 2, 3, 4, 5]))),
    );

    const result = await paginate<Item>(PAGE_1, creds, { limit: 2 });
    expect(result.map((r) => r.id)).toEqual([1, 2]);
  });

  test("follows `next` cursor and concatenates pages", async () => {
    const seen: string[] = [];
    server.use(
      http.get(BASE_PATH, ({ request }) => {
        const url = new URL(request.url);
        seen.push(url.toString());
        const pageNum = url.searchParams.get("page");
        if (pageNum === "1") return HttpResponse.json(page([1, 2], PAGE_2));
        if (pageNum === "2") return HttpResponse.json(page([3, 4], PAGE_3));
        if (pageNum === "3") return HttpResponse.json(page([5]));
        return HttpResponse.json({ error: "unexpected" }, { status: 500 });
      }),
    );

    const result = await paginate<Item>(PAGE_1, creds, { limit: 100 });

    expect(result.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(seen).toEqual([PAGE_1, PAGE_2, PAGE_3]);
  });

  test("stops fetching once limit is reached mid-page", async () => {
    const seen: string[] = [];
    server.use(
      http.get(BASE_PATH, ({ request }) => {
        const url = new URL(request.url);
        seen.push(url.toString());
        const pageNum = url.searchParams.get("page");
        if (pageNum === "1") return HttpResponse.json(page([1, 2], PAGE_2));
        if (pageNum === "2") return HttpResponse.json(page([3, 4, 5], PAGE_3));
        return HttpResponse.json({ error: "should not have requested" }, { status: 500 });
      }),
    );

    const result = await paginate<Item>(PAGE_1, creds, { limit: 4 });

    expect(result.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(seen).toEqual([PAGE_1, PAGE_2]);
  });

  test("attaches Basic auth on every request (including the first)", async () => {
    let seenAuth = null as string | null;
    let seenAccept = null as string | null;
    server.use(
      http.get(BASE_PATH, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        seenAccept = request.headers.get("accept");
        return HttpResponse.json(page([1]));
      }),
    );

    await paginate<Item>(PAGE_1, creds, { limit: 100 });

    expect(seenAuth!).toBe("Basic " + btoa("a@b.co:t"));
    expect(seenAccept!).toBe("application/json");
  });

  test("refuses to fetch a URL outside the Bitbucket API origin", async () => {
    // No handler needed — the origin check in paginate fires before any
    // network call is attempted. (If it did somehow escape, msw's
    // onUnhandledRequest: "error" would surface the bug loudly.)
    const err = await paginate<Item>(
      "https://evil.example.com/2.0/foo",
      creds,
      { limit: 100 },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(PaginationError);
    expect((err as Error).message).toContain("evil.example.com");
  });

  test("refuses to follow a cross-origin `next` URL", async () => {
    server.use(
      http.get(BASE_PATH, () =>
        HttpResponse.json(page([1], "https://evil.example.com/foo")),
      ),
    );

    const err = await paginate<Item>(PAGE_1, creds, { limit: 100 })
      .catch((e) => e);

    expect(err).toBeInstanceOf(PaginationError);
    expect((err as Error).message).toContain("evil.example.com");
  });

  test("throws PaginationError on HTTP failure", async () => {
    server.use(
      http.get(BASE_PATH, () =>
        HttpResponse.json({ type: "error" }, { status: 500 }),
      ),
    );

    const err = await paginate<Item>(PAGE_1, creds, { limit: 100 })
      .catch((e) => e);

    expect(err).toBeInstanceOf(PaginationError);
    expect((err as PaginationError).status).toBe(500);
  });

  test("handles a missing `values` array as empty", async () => {
    server.use(http.get(BASE_PATH, () => HttpResponse.json({})));
    const result = await paginate<Item>(PAGE_1, creds, { limit: 100 });
    expect(result).toEqual([]);
  });
});
