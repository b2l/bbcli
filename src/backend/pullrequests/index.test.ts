import { test, expect, describe } from "bun:test";
import {
  listPullRequests,
  PullRequestError,
  type PullRequest,
} from "./index.ts";

type Call = { pathname: string; searchParams: URLSearchParams };

type Handler = (req: {
  pathname: string;
  searchParams: URLSearchParams;
}) => { status: number; body: unknown };

function mockFetch(handler: Handler): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(raw);
    const pathname = url.pathname.replace("/2.0", "");
    calls.push({ pathname, searchParams: url.searchParams });
    const { status, body } = handler({ pathname, searchParams: url.searchParams });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const creds = { email: "a@b.co", token: "t" };
const ref = { workspace: "ws", slug: "repo" };

function makePr(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    title: "A PR",
    state: "OPEN",
    author: { uuid: "{alice-uuid}", display_name: "Alice", nickname: "alice" },
    created_on: "2026-04-10T00:00:00Z",
    updated_on: "2026-04-13T00:00:00Z",
    links: { html: { href: "https://bitbucket.org/ws/repo/pull-requests/1" } },
    ...overrides,
  };
}

describe("listPullRequests", () => {
  test("default query: state=OPEN, sort=-updated_on", async () => {
    const { fetch, calls } = mockFetch(() => ({
      status: 200,
      body: { values: [makePr({ id: 42, title: "fix bug" })] },
    }));

    const result = await listPullRequests(
      creds,
      ref,
      { state: "open", limit: 30 },
      fetch,
    );

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.pathname).toBe("/repositories/ws/repo/pullrequests");
    expect(call.searchParams.getAll("state")).toEqual(["OPEN"]);
    expect(call.searchParams.get("sort")).toBe("-updated_on");
    expect(call.searchParams.has("q")).toBe(false);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(42);
    expect(result[0]!.title).toBe("fix bug");
  });

  test("state=all expands to repeated state params", async () => {
    const { fetch, calls } = mockFetch(() => ({
      status: 200,
      body: { values: [] },
    }));

    await listPullRequests(
      creds,
      ref,
      { state: "all", limit: 30 },
      fetch,
    );

    expect(calls[0]!.searchParams.getAll("state")).toEqual([
      "OPEN",
      "MERGED",
      "DECLINED",
      "SUPERSEDED",
    ]);
  });

  test("author @me builds BBQL with uuid", async () => {
    const { fetch, calls } = mockFetch(() => ({
      status: 200,
      body: { values: [] },
    }));

    await listPullRequests(
      creds,
      ref,
      {
        state: "open",
        limit: 30,
        author: { kind: "me" },
        currentUserUuid: "{uuid-1}",
      },
      fetch,
    );

    expect(calls[0]!.searchParams.get("q")).toBe(
      'state="OPEN" AND author.uuid="{uuid-1}"',
    );
  });

  test("author nickname builds BBQL with nickname", async () => {
    const { fetch, calls } = mockFetch(() => ({
      status: 200,
      body: { values: [] },
    }));

    await listPullRequests(
      creds,
      ref,
      {
        state: "open",
        limit: 30,
        author: { kind: "nickname", value: "jsmith" },
      },
      fetch,
    );

    expect(calls[0]!.searchParams.get("q")).toBe(
      'state="OPEN" AND author.nickname="jsmith"',
    );
  });

  test("author and reviewer are combined with AND", async () => {
    const { fetch, calls } = mockFetch(() => ({
      status: 200,
      body: { values: [] },
    }));

    await listPullRequests(
      creds,
      ref,
      {
        state: "open",
        limit: 30,
        author: { kind: "nickname", value: "alice" },
        reviewer: { kind: "nickname", value: "bob" },
      },
      fetch,
    );

    expect(calls[0]!.searchParams.get("q")).toBe(
      'state="OPEN" AND author.nickname="alice" AND reviewers.nickname="bob"',
    );
  });

  test("state filter is folded into q when a user filter is present", async () => {
    // Bitbucket ignores the `state=` query param when `q` is set, so the
    // state constraint has to live inside the BBQL expression.
    const { fetch, calls } = mockFetch(() => ({
      status: 200,
      body: { values: [] },
    }));

    await listPullRequests(
      creds,
      ref,
      {
        state: "open",
        limit: 30,
        reviewer: { kind: "me" },
        currentUserUuid: "{me-uuid}",
      },
      fetch,
    );

    expect(calls[0]!.searchParams.getAll("state")).toEqual([]);
    expect(calls[0]!.searchParams.get("q")).toBe(
      'state="OPEN" AND reviewers.uuid="{me-uuid}"',
    );
  });

  test("multi-state folds into q as OR group when combined with a filter", async () => {
    const { fetch, calls } = mockFetch(() => ({
      status: 200,
      body: { values: [] },
    }));

    await listPullRequests(
      creds,
      ref,
      {
        state: "all",
        limit: 30,
        author: { kind: "nickname", value: "alice" },
      },
      fetch,
    );

    expect(calls[0]!.searchParams.getAll("state")).toEqual([]);
    expect(calls[0]!.searchParams.get("q")).toBe(
      '(state="OPEN" OR state="MERGED" OR state="DECLINED" OR state="SUPERSEDED") AND author.nickname="alice"',
    );
  });

  test("follows next cursor until limit reached", async () => {
    const { fetch, calls } = mockFetch(({ searchParams }) => {
      const page = searchParams.get("page") ?? "1";
      const values = page === "1"
        ? [makePr({ id: 1 }), makePr({ id: 2 })]
        : [makePr({ id: 3 }), makePr({ id: 4 })];
      const next = page === "1"
        ? "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests?page=2&state=OPEN&sort=-updated_on&pagelen=50"
        : undefined;
      return { status: 200, body: { values, next } };
    });

    const result = await listPullRequests(
      creds,
      ref,
      { state: "open", limit: 3 },
      fetch,
    );

    expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.searchParams.get("page")).toBe("2");
  });

  test("stops paging when Bitbucket omits next even if under limit", async () => {
    const { fetch, calls } = mockFetch(({ searchParams }) => {
      const page = searchParams.get("page") ?? "1";
      if (page === "1") {
        return {
          status: 200,
          body: {
            values: [makePr({ id: 1 }), makePr({ id: 2 })],
            next: "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests?page=2",
          },
        };
      }
      return { status: 200, body: { values: [makePr({ id: 3 })] } };
    });

    const result = await listPullRequests(
      creds,
      ref,
      { state: "open", limit: 100 },
      fetch,
    );

    expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(2);
  });

  test("next cursor preserves repeated state params and sort", async () => {
    const { fetch, calls } = mockFetch(({ searchParams }) => {
      const page = searchParams.get("page");
      if (!page) {
        return {
          status: 200,
          body: {
            values: [makePr({ id: 1 })],
            next: "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests?page=2&state=OPEN&state=MERGED&sort=-updated_on",
          },
        };
      }
      return { status: 200, body: { values: [] } };
    });

    await listPullRequests(
      creds,
      ref,
      { state: "all", limit: 100 },
      fetch,
    );

    expect(calls[1]!.searchParams.getAll("state")).toEqual(["OPEN", "MERGED"]);
    expect(calls[1]!.searchParams.get("sort")).toBe("-updated_on");
    expect(calls[1]!.searchParams.get("page")).toBe("2");
  });

  test("maps API fields to summary shape", async () => {
    const { fetch } = mockFetch(() => ({
      status: 200,
      body: {
        values: [
          makePr({
            id: 7,
            title: "Refactor auth",
            state: "MERGED",
            author: {
              uuid: "{alice-uuid}",
              display_name: "Alice A.",
              nickname: "alice",
            },
            created_on: "2026-04-01T10:00:00Z",
            updated_on: "2026-04-12T10:00:00Z",
            links: { html: { href: "https://bitbucket.org/ws/repo/pull-requests/7" } },
          }),
        ],
      },
    }));

    const result = await listPullRequests(
      creds,
      ref,
      { state: "all", limit: 10 },
      fetch,
    );

    expect(result[0]).toEqual<PullRequest>({
      id: 7,
      title: "Refactor auth",
      state: "MERGED",
      author: {
        uuid: "{alice-uuid}",
        displayName: "Alice A.",
        nickname: "alice",
      },
      createdOn: "2026-04-01T10:00:00Z",
      updatedOn: "2026-04-12T10:00:00Z",
      url: "https://bitbucket.org/ws/repo/pull-requests/7",
    });
  });

  test("author is null when raw has no uuid (deleted user)", async () => {
    const { fetch } = mockFetch(() => ({
      status: 200,
      body: {
        values: [makePr({ id: 9, author: null })],
      },
    }));

    const result = await listPullRequests(
      creds,
      ref,
      { state: "all", limit: 10 },
      fetch,
    );

    expect(result[0]!.author).toBeNull();
  });

  test("throws PullRequestError on non-ok response", async () => {
    const { fetch } = mockFetch(() => ({ status: 404, body: { type: "error" } }));

    const err = await listPullRequests(
      creds,
      ref,
      { state: "open", limit: 30 },
      fetch,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(PullRequestError);
    expect((err as PullRequestError).status).toBe(404);
  });

});
