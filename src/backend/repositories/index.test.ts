import { describe, expect, test } from "bun:test";
import { HttpResponse, http } from "msw";
import { BITBUCKET_BASE, server, setupMsw } from "../../test/msw/server.ts";
import { getRepository, type Repository, RepositoryError } from "./index.ts";

setupMsw();

const creds = { email: "a@b.co", token: "t" };
const ref = { workspace: "acme", slug: "widgets" };
const REPO_PATH = `${BITBUCKET_BASE}/repositories/acme/widgets`;

function makeRepo(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		type: "repository",
		full_name: "acme/widgets",
		name: "widgets",
		description: "The widgets service",
		is_private: true,
		language: "typescript",
		created_on: "2024-01-10T10:00:00Z",
		updated_on: "2026-04-20T10:00:00Z",
		size: 12345,
		owner: { display_name: "ACME", nickname: "acme" },
		mainbranch: { name: "main", type: "branch" },
		links: { html: { href: "https://bitbucket.org/acme/widgets" } },
		...overrides,
	};
}

describe("getRepository", () => {
	test("maps the repository response to the flat Repository shape", async () => {
		server.use(http.get(REPO_PATH, () => HttpResponse.json(makeRepo())));

		const result = await getRepository(creds, ref);

		expect(result).toEqual<Repository>({
			fullName: "acme/widgets",
			name: "widgets",
			owner: "ACME",
			description: "The widgets service",
			defaultBranch: "main",
			language: "typescript",
			isPrivate: true,
			createdOn: "2024-01-10T10:00:00Z",
			updatedOn: "2026-04-20T10:00:00Z",
			size: 12345,
			url: "https://bitbucket.org/acme/widgets",
		});
	});

	test("falls back through owner display_name → nickname → username", async () => {
		server.use(
			http.get(REPO_PATH, () =>
				HttpResponse.json(makeRepo({ owner: { username: "legacyuser" } })),
			),
		);

		const result = await getRepository(creds, ref);
		expect(result.owner).toBe("legacyuser");
	});

	test("handles missing optional fields with empty/zero defaults", async () => {
		// Strip everything optional. Keeps the mapping function from reaching
		// through undefined without guards.
		server.use(
			http.get(REPO_PATH, () =>
				HttpResponse.json({ type: "repository", full_name: "acme/widgets" }),
			),
		);

		const result = await getRepository(creds, ref);
		expect(result).toEqual<Repository>({
			fullName: "acme/widgets",
			name: "",
			owner: "",
			description: "",
			defaultBranch: "",
			language: "",
			isPrivate: false,
			createdOn: "",
			updatedOn: "",
			size: 0,
			url: "",
		});
	});

	test("throws RepositoryError on 404", async () => {
		server.use(
			http.get(REPO_PATH, () =>
				HttpResponse.json({ type: "error" }, { status: 404 }),
			),
		);

		const err = await getRepository(creds, ref).catch((e) => e);
		expect(err).toBeInstanceOf(RepositoryError);
		expect((err as RepositoryError).status).toBe(404);
	});

	test("throws RepositoryError on 403 (private, no access)", async () => {
		server.use(
			http.get(REPO_PATH, () =>
				HttpResponse.json({ type: "error" }, { status: 403 }),
			),
		);

		const err = await getRepository(creds, ref).catch((e) => e);
		expect(err).toBeInstanceOf(RepositoryError);
		expect((err as RepositoryError).status).toBe(403);
	});
});
