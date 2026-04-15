import { describe, expect, test } from "bun:test";
import { HttpResponse, http } from "msw";
import { BITBUCKET_BASE, server, setupMsw } from "../../test/msw/server.ts";
import { listWorkspaces, WorkspaceError } from "./index.ts";

setupMsw();

const creds = { email: "a@b.co", token: "t" };

describe("listWorkspaces", () => {
	test("returns workspaces with slug and admin flag", async () => {
		server.use(
			http.get(`${BITBUCKET_BASE}/user/workspaces`, () =>
				HttpResponse.json({
					values: [
						{
							workspace: { slug: "team-a", uuid: "{aaa}" },
							administrator: true,
						},
						{
							workspace: { slug: "team-b", uuid: "{bbb}" },
							administrator: false,
						},
					],
				}),
			),
		);

		const result = await listWorkspaces(creds);
		expect(result).toEqual([
			{ slug: "team-a", administrator: true },
			{ slug: "team-b", administrator: false },
		]);
	});

	test("returns empty array when user has no workspaces", async () => {
		server.use(
			http.get(`${BITBUCKET_BASE}/user/workspaces`, () =>
				HttpResponse.json({ values: [] }),
			),
		);

		const result = await listWorkspaces(creds);
		expect(result).toEqual([]);
	});

	test("throws WorkspaceError on failure", async () => {
		server.use(
			http.get(`${BITBUCKET_BASE}/user/workspaces`, () =>
				HttpResponse.json({ type: "error" }, { status: 401 }),
			),
		);

		const err = await listWorkspaces(creds).catch((e) => e);
		expect(err).toBeInstanceOf(WorkspaceError);
		expect((err as WorkspaceError).status).toBe(401);
	});

	test("sends pagelen=100 on the request", async () => {
		// New assertion capability msw gives us: inspect the actual outgoing
		// request rather than hand-rolling URL parsing in the mock.
		let seenPagelen = null as string | null;
		server.use(
			http.get(`${BITBUCKET_BASE}/user/workspaces`, ({ request }) => {
				seenPagelen = new URL(request.url).searchParams.get("pagelen");
				return HttpResponse.json({ values: [] });
			}),
		);

		await listWorkspaces(creds);
		expect(seenPagelen!).toBe("100");
	});
});
