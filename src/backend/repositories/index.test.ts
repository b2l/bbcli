import { describe, expect, test } from "bun:test";
import { HttpResponse, http } from "msw";
import { BITBUCKET_BASE, server, setupMsw } from "../../test/msw/server.ts";
import {
	getRepositoryCloneLinks,
	listRepositories,
	type Repository,
	RepositoryError,
} from "./index.ts";

setupMsw();

const creds = { email: "a@b.co", token: "t" };

const REPO_LIST_PATH = `${BITBUCKET_BASE}/repositories/ws`;
const REPO_DETAIL_PATH = `${BITBUCKET_BASE}/repositories/ws/my-repo`;

function makeRepo(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		type: "repository",
		slug: "my-repo",
		name: "My Repo",
		full_name: "ws/my-repo",
		description: "A repo",
		is_private: true,
		language: "typescript",
		updated_on: "2026-04-20T10:00:00Z",
		links: {
			html: { href: "https://bitbucket.org/ws/my-repo" },
			clone: [
				{ name: "https", href: "https://bitbucket.org/ws/my-repo.git" },
				{ name: "ssh", href: "git@bitbucket.org:ws/my-repo.git" },
			],
		},
		...overrides,
	};
}

describe("listRepositories", () => {
	test("default query: sort=-updated_on, pagelen=50", async () => {
		const calls: URLSearchParams[] = [];
		server.use(
			http.get(REPO_LIST_PATH, ({ request }) => {
				calls.push(new URL(request.url).searchParams);
				return HttpResponse.json({ values: [makeRepo()] });
			}),
		);

		const result = await listRepositories(creds, "ws", { limit: 30 });

		expect(calls).toHaveLength(1);
		expect(calls[0]?.get("sort")).toBe("-updated_on");
		expect(calls[0]?.get("pagelen")).toBe("50");
		expect(calls[0]?.has("q")).toBe(false);
		expect(result).toHaveLength(1);
		expect(result[0]?.slug).toBe("my-repo");
	});

	test("query option builds BBQL name filter", async () => {
		const calls: URLSearchParams[] = [];
		server.use(
			http.get(REPO_LIST_PATH, ({ request }) => {
				calls.push(new URL(request.url).searchParams);
				return HttpResponse.json({ values: [] });
			}),
		);

		await listRepositories(creds, "ws", { limit: 30, query: "frontend" });

		expect(calls[0]?.get("q")).toBe('name ~ "frontend"');
	});

	test("maps API fields to Repository shape", async () => {
		server.use(
			http.get(REPO_LIST_PATH, () =>
				HttpResponse.json({
					values: [
						makeRepo({
							slug: "api-lib",
							name: "API Lib",
							full_name: "ws/api-lib",
							description: "Core API library",
							is_private: false,
							language: "python",
							updated_on: "2026-04-15T12:00:00Z",
							links: {
								html: { href: "https://bitbucket.org/ws/api-lib" },
							},
						}),
					],
				}),
			),
		);

		const result = await listRepositories(creds, "ws", { limit: 10 });

		expect(result[0]).toEqual<Repository>({
			slug: "api-lib",
			name: "API Lib",
			fullName: "ws/api-lib",
			description: "Core API library",
			isPrivate: false,
			language: "python",
			updatedOn: "2026-04-15T12:00:00Z",
			url: "https://bitbucket.org/ws/api-lib",
		});
	});

	test("follows next cursor until limit reached", async () => {
		const calls: URLSearchParams[] = [];
		server.use(
			http.get(REPO_LIST_PATH, ({ request }) => {
				const params = new URL(request.url).searchParams;
				calls.push(params);
				const page = params.get("page") ?? "1";
				const values =
					page === "1"
						? [makeRepo({ slug: "r1" }), makeRepo({ slug: "r2" })]
						: [makeRepo({ slug: "r3" }), makeRepo({ slug: "r4" })];
				const next =
					page === "1"
						? `${REPO_LIST_PATH}?page=2&sort=-updated_on&pagelen=50`
						: undefined;
				return HttpResponse.json({ values, next });
			}),
		);

		const result = await listRepositories(creds, "ws", { limit: 3 });

		expect(result.map((r) => r.slug)).toEqual(["r1", "r2", "r3"]);
		expect(calls).toHaveLength(2);
	});

	test("throws RepositoryError on non-ok response", async () => {
		server.use(
			http.get(REPO_LIST_PATH, () =>
				HttpResponse.json({ type: "error" }, { status: 404 }),
			),
		);

		const err = await listRepositories(creds, "ws", { limit: 30 }).catch(
			(e) => e,
		);

		expect(err).toBeInstanceOf(RepositoryError);
		expect((err as RepositoryError).status).toBe(404);
	});

	test("escapes quotes in query string", async () => {
		const calls: URLSearchParams[] = [];
		server.use(
			http.get(REPO_LIST_PATH, ({ request }) => {
				calls.push(new URL(request.url).searchParams);
				return HttpResponse.json({ values: [] });
			}),
		);

		await listRepositories(creds, "ws", {
			limit: 30,
			query: 'my "repo"',
		});

		expect(calls[0]?.get("q")).toBe('name ~ "my \\"repo\\""');
	});
});

describe("getRepositoryCloneLinks", () => {
	test("returns ssh and https clone links", async () => {
		server.use(http.get(REPO_DETAIL_PATH, () => HttpResponse.json(makeRepo())));

		const links = await getRepositoryCloneLinks(creds, {
			workspace: "ws",
			slug: "my-repo",
		});

		expect(links).toEqual({
			ssh: "git@bitbucket.org:ws/my-repo.git",
			https: "https://bitbucket.org/ws/my-repo.git",
		});
	});

	test("returns undefined for missing clone links", async () => {
		server.use(
			http.get(REPO_DETAIL_PATH, () =>
				HttpResponse.json(makeRepo({ links: { html: { href: "" } } })),
			),
		);

		const links = await getRepositoryCloneLinks(creds, {
			workspace: "ws",
			slug: "my-repo",
		});

		expect(links).toEqual({ ssh: undefined, https: undefined });
	});

	test("throws RepositoryError on 404", async () => {
		server.use(
			http.get(REPO_DETAIL_PATH, () =>
				HttpResponse.json({ type: "error" }, { status: 404 }),
			),
		);

		const err = await getRepositoryCloneLinks(creds, {
			workspace: "ws",
			slug: "my-repo",
		}).catch((e) => e);

		expect(err).toBeInstanceOf(RepositoryError);
		expect((err as RepositoryError).status).toBe(404);
	});
});
