import { describe, expect, test } from "bun:test";
import { HttpResponse, http } from "msw";
import { BITBUCKET_BASE, server, setupMsw } from "../../test/msw/server.ts";
import {
	type PaginatedResponse,
	PaginationError,
	withPagination,
} from "./paginate.ts";

setupMsw();

const creds = { email: "a@b.co", token: "t" };

type Item = { id: number };

const FOLLOW_PATH = `${BITBUCKET_BASE}/repositories/ws/repo/pullrequests`;
const NEXT_2 = `${FOLLOW_PATH}?page=2`;
const NEXT_3 = `${FOLLOW_PATH}?page=3`;

function pageBody(ids: number[], next?: string): PaginatedResponse<Item> {
	return { values: ids.map((id) => ({ id })), ...(next ? { next } : {}) };
}

/**
 * Builds a stub of the `firstCall` argument `withPagination` expects —
 * a closure resolving to an openapi-fetch-shaped `{ data, response }`.
 * `status` is required so every call site declares the simulated HTTP
 * status explicitly.
 */
function mockFirstCall(
	body: PaginatedResponse<Item>,
	{ status }: { status: number },
): () => Promise<{ data?: PaginatedResponse<Item>; response: Response }> {
	return async () => ({
		data: status >= 200 && status < 300 ? body : undefined,
		response: new Response(null, { status }),
	});
}

describe("withPagination", () => {
	test("returns items from the first page when no `next`", async () => {
		const result = await withPagination(
			mockFirstCall(pageBody([1, 2, 3]), { status: 200 }),
			creds,
			{ limit: 100 },
		);
		expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
	});

	test("truncates the first page when `limit` is smaller", async () => {
		const result = await withPagination(
			mockFirstCall(pageBody([1, 2, 3, 4, 5]), { status: 200 }),
			creds,
			{ limit: 2 },
		);
		expect(result.map((r) => r.id)).toEqual([1, 2]);
	});

	test("follows `next` cursor and concatenates pages", async () => {
		const seen: string[] = [];
		server.use(
			http.get(FOLLOW_PATH, ({ request }) => {
				const url = new URL(request.url);
				seen.push(url.toString());
				const pageNum = url.searchParams.get("page");
				if (pageNum === "2") return HttpResponse.json(pageBody([3, 4], NEXT_3));
				if (pageNum === "3") return HttpResponse.json(pageBody([5]));
				return HttpResponse.json({ error: "unexpected" }, { status: 500 });
			}),
		);

		const result = await withPagination(
			mockFirstCall(pageBody([1, 2], NEXT_2), { status: 200 }),
			creds,
			{ limit: 100 },
		);

		expect(result.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
		expect(seen).toEqual([NEXT_2, NEXT_3]);
	});

	test("stops fetching once limit is reached mid-page", async () => {
		const seen: string[] = [];
		server.use(
			http.get(FOLLOW_PATH, ({ request }) => {
				const url = new URL(request.url);
				seen.push(url.toString());
				const pageNum = url.searchParams.get("page");
				if (pageNum === "2")
					return HttpResponse.json(pageBody([3, 4, 5], NEXT_3));
				return HttpResponse.json(
					{ error: "should not have requested" },
					{ status: 500 },
				);
			}),
		);

		const result = await withPagination(
			mockFirstCall(pageBody([1, 2], NEXT_2), { status: 200 }),
			creds,
			{ limit: 4 },
		);

		expect(result.map((r) => r.id)).toEqual([1, 2, 3, 4]);
		expect(seen).toEqual([NEXT_2]);
	});

	test("attaches Basic auth on cursor-follow requests", async () => {
		let seenAuth = null as string | null;
		let seenAccept = null as string | null;
		server.use(
			http.get(FOLLOW_PATH, ({ request }) => {
				seenAuth = request.headers.get("authorization");
				seenAccept = request.headers.get("accept");
				return HttpResponse.json(pageBody([2]));
			}),
		);

		await withPagination(
			mockFirstCall(pageBody([1], NEXT_2), { status: 200 }),
			creds,
			{ limit: 100 },
		);

		expect(seenAuth!).toBe(`Basic ${btoa("a@b.co:t")}`);
		expect(seenAccept!).toBe("application/json");
	});

	test("refuses to follow a cross-origin `next` URL", async () => {
		const err = await withPagination(
			mockFirstCall(pageBody([1], "https://evil.example.com/2.0/foo"), {
				status: 200,
			}),
			creds,
			{ limit: 100 },
		).catch((e) => e);

		expect(err).toBeInstanceOf(PaginationError);
		expect((err as Error).message).toContain("evil.example.com");
	});

	test("throws PaginationError when first call returns a non-ok response", async () => {
		const err = await withPagination(
			mockFirstCall({ values: [] }, { status: 500 }),
			creds,
			{ limit: 100 },
		).catch((e) => e);

		expect(err).toBeInstanceOf(PaginationError);
		expect((err as PaginationError).status).toBe(500);
	});

	test("throws PaginationError when cursor-follow returns a non-ok response", async () => {
		server.use(
			http.get(FOLLOW_PATH, () =>
				HttpResponse.json({ type: "error" }, { status: 500 }),
			),
		);

		const err = await withPagination(
			mockFirstCall(pageBody([1], NEXT_2), { status: 200 }),
			creds,
			{ limit: 100 },
		).catch((e) => e);

		expect(err).toBeInstanceOf(PaginationError);
		expect((err as PaginationError).status).toBe(500);
	});

	test("handles a missing `values` array as empty", async () => {
		const result = await withPagination(
			mockFirstCall({}, { status: 200 }),
			creds,
			{ limit: 100 },
		);
		expect(result).toEqual([]);
	});
});
