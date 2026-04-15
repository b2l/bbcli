import { describe, expect, test } from "bun:test";
import { HttpResponse, http } from "msw";
import { BITBUCKET_BASE, server, setupMsw } from "../../test/msw/server.ts";
import { getCurrentUser, UserError } from "./index.ts";

setupMsw();

const creds = { email: "a@b.co", token: "t" };

describe("getCurrentUser", () => {
	test("returns uuid and display name", async () => {
		server.use(
			http.get(`${BITBUCKET_BASE}/user`, () =>
				HttpResponse.json({ uuid: "{abc-123}", display_name: "Alice" }),
			),
		);

		const result = await getCurrentUser(creds);
		expect(result).toEqual({ uuid: "{abc-123}", displayName: "Alice" });
	});

	test("falls back to empty display name when absent", async () => {
		server.use(
			http.get(`${BITBUCKET_BASE}/user`, () =>
				HttpResponse.json({ uuid: "{abc-123}" }),
			),
		);

		const result = await getCurrentUser(creds);
		expect(result.displayName).toBe("");
	});

	test("throws UserError on failure", async () => {
		server.use(
			http.get(`${BITBUCKET_BASE}/user`, () =>
				HttpResponse.json({ type: "error" }, { status: 401 }),
			),
		);

		const err = await getCurrentUser(creds).catch((e) => e);
		expect(err).toBeInstanceOf(UserError);
		expect((err as UserError).status).toBe(401);
	});
});
