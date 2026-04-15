import { describe, expect, test } from "bun:test";
import { HttpResponse, http } from "msw";
import type { components } from "../../shared/bitbucket-http/generated";
import { BITBUCKET_BASE, server, setupMsw } from "../../test/msw/server.ts";
import { BitbucketAuthError, verifyCredentials } from "./index.ts";

type Account = components["schemas"]["account"];
type BitbucketError = components["schemas"]["error"];

setupMsw();

const creds = { email: "a@b.co", token: "t" };

describe("verifyCredentials", () => {
	test("returns the account on HTTP 200", async () => {
		const account: Account = {
			type: "account",
			display_name: "Alice Example",
			uuid: "{abc-123}",
		};
		server.use(
			http.get(`${BITBUCKET_BASE}/user`, () => HttpResponse.json(account)),
		);

		const user = await verifyCredentials(creds);
		expect(user).toMatchObject(account);
	});

	test("throws BitbucketAuthError with status 401 on HTTP 401", async () => {
		const body: BitbucketError = {
			type: "error",
			error: { message: "Bad credentials" },
		};
		server.use(
			http.get(`${BITBUCKET_BASE}/user`, () =>
				HttpResponse.json(body, { status: 401 }),
			),
		);

		const err = await verifyCredentials(creds).catch((e) => e);
		expect(err).toBeInstanceOf(BitbucketAuthError);
		expect((err as BitbucketAuthError).status).toBe(401);
		expect((err as BitbucketAuthError).message).toContain("rejected");
	});

	test("throws BitbucketAuthError with status 403 on HTTP 403", async () => {
		const body: BitbucketError = {
			type: "error",
			error: { message: "Insufficient scopes" },
		};
		server.use(
			http.get(`${BITBUCKET_BASE}/user`, () =>
				HttpResponse.json(body, { status: 403 }),
			),
		);

		const err = await verifyCredentials(creds).catch((e) => e);
		expect(err).toBeInstanceOf(BitbucketAuthError);
		expect((err as BitbucketAuthError).status).toBe(403);
		expect((err as BitbucketAuthError).message).toContain("account:read");
	});

	test("throws BitbucketAuthError on unexpected HTTP 500", async () => {
		const body: BitbucketError = {
			type: "error",
			error: { message: "Internal server error" },
		};
		server.use(
			http.get(`${BITBUCKET_BASE}/user`, () =>
				HttpResponse.json(body, { status: 500 }),
			),
		);

		const err = await verifyCredentials(creds).catch((e) => e);
		expect(err).toBeInstanceOf(BitbucketAuthError);
		expect((err as BitbucketAuthError).status).toBe(500);
		expect((err as BitbucketAuthError).message).toContain("500");
	});

	test("propagates network errors", async () => {
		server.use(http.get(`${BITBUCKET_BASE}/user`, () => HttpResponse.error()));

		const err = await verifyCredentials(creds).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
	});
});
