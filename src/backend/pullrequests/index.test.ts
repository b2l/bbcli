import { describe, expect, test } from "bun:test";
import { HttpResponse, http } from "msw";
import { BITBUCKET_BASE, server, setupMsw } from "../../test/msw/server.ts";
import {
	createPullRequest,
	createPullRequestComment,
	findOpenPullRequestForBranch,
	getPullRequest,
	listEffectiveDefaultReviewers,
	listPullRequests,
	type PullRequest,
	type PullRequestDetail,
	PullRequestError,
} from "./index.ts";

setupMsw();

const creds = { email: "a@b.co", token: "t" };
const ref = { workspace: "ws", slug: "repo" };

const PR_LIST_PATH = `${BITBUCKET_BASE}/repositories/ws/repo/pullrequests`;
const PR_DETAIL_PATH = (id: number) =>
	`${BITBUCKET_BASE}/repositories/ws/repo/pullrequests/${id}`;

function makePr(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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

function makePrDetail(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: 42,
		title: "Rework auth",
		state: "OPEN",
		author: { uuid: "{alice}", display_name: "Alice", nickname: "alice" },
		created_on: "2026-04-10T00:00:00Z",
		updated_on: "2026-04-13T00:00:00Z",
		summary: {
			raw: "A detailed PR description.\n\n- fix thing\n- fix other thing",
		},
		source: { branch: { name: "feature/auth" } },
		destination: { branch: { name: "main" } },
		links: { html: { href: "https://bitbucket.org/ws/repo/pull-requests/42" } },
		participants: [
			{
				role: "REVIEWER",
				user: { uuid: "{bob}", display_name: "Bob", nickname: "bob" },
				state: "approved",
			},
			{
				role: "REVIEWER",
				user: { uuid: "{carol}", display_name: "Carol", nickname: "carol" },
				state: "changes_requested",
			},
			{
				role: "REVIEWER",
				user: { uuid: "{dave}", display_name: "Dave", nickname: "dave" },
				state: null,
			},
			// non-reviewer participants (plain commenters) should be dropped
			{
				role: "PARTICIPANT",
				user: { uuid: "{eve}", display_name: "Eve", nickname: "eve" },
				state: null,
			},
		],
		...overrides,
	};
}

/**
 * Records every request seen at `path`, handing each to `responder` to
 * produce the mocked response. Returns the list of captured URLSearchParams
 * so tests can assert on query shape.
 */
function captureListRequests(
	responder: (req: Request) => Response | Promise<Response>,
): URLSearchParams[] {
	const calls: URLSearchParams[] = [];
	server.use(
		http.get(PR_LIST_PATH, async ({ request }) => {
			calls.push(new URL(request.url).searchParams);
			return responder(request);
		}),
	);
	return calls;
}

describe("listPullRequests", () => {
	test("default query: state=OPEN, sort=-updated_on", async () => {
		const calls = captureListRequests(() =>
			HttpResponse.json({ values: [makePr({ id: 42, title: "fix bug" })] }),
		);

		const result = await listPullRequests(creds, ref, {
			state: "open",
			limit: 30,
		});

		expect(calls).toHaveLength(1);
		const params = calls[0]!;
		expect(params.getAll("state")).toEqual(["OPEN"]);
		expect(params.get("sort")).toBe("-updated_on");
		expect(params.has("q")).toBe(false);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe(42);
		expect(result[0]?.title).toBe("fix bug");
	});

	test("state=all expands to repeated state params", async () => {
		const calls = captureListRequests(() => HttpResponse.json({ values: [] }));

		await listPullRequests(creds, ref, { state: "all", limit: 30 });

		expect(calls[0]?.getAll("state")).toEqual([
			"OPEN",
			"MERGED",
			"DECLINED",
			"SUPERSEDED",
		]);
	});

	test("author @me builds BBQL with uuid", async () => {
		const calls = captureListRequests(() => HttpResponse.json({ values: [] }));

		await listPullRequests(creds, ref, {
			state: "open",
			limit: 30,
			author: { kind: "me" },
			currentUserUuid: "{uuid-1}",
		});

		expect(calls[0]?.get("q")).toBe('state="OPEN" AND author.uuid="{uuid-1}"');
	});

	test("author nickname builds BBQL with nickname", async () => {
		const calls = captureListRequests(() => HttpResponse.json({ values: [] }));

		await listPullRequests(creds, ref, {
			state: "open",
			limit: 30,
			author: { kind: "nickname", value: "jsmith" },
		});

		expect(calls[0]?.get("q")).toBe(
			'state="OPEN" AND author.nickname="jsmith"',
		);
	});

	test("author and reviewer are combined with AND", async () => {
		const calls = captureListRequests(() => HttpResponse.json({ values: [] }));

		await listPullRequests(creds, ref, {
			state: "open",
			limit: 30,
			author: { kind: "nickname", value: "alice" },
			reviewer: { kind: "nickname", value: "bob" },
		});

		expect(calls[0]?.get("q")).toBe(
			'state="OPEN" AND author.nickname="alice" AND reviewers.nickname="bob"',
		);
	});

	test("state filter is folded into q when a user filter is present", async () => {
		// Bitbucket ignores the `state=` query param when `q` is set, so the
		// state constraint has to live inside the BBQL expression.
		const calls = captureListRequests(() => HttpResponse.json({ values: [] }));

		await listPullRequests(creds, ref, {
			state: "open",
			limit: 30,
			reviewer: { kind: "me" },
			currentUserUuid: "{me-uuid}",
		});

		expect(calls[0]?.getAll("state")).toEqual([]);
		expect(calls[0]?.get("q")).toBe(
			'state="OPEN" AND reviewers.uuid="{me-uuid}"',
		);
	});

	test("multi-state folds into q as OR group when combined with a filter", async () => {
		const calls = captureListRequests(() => HttpResponse.json({ values: [] }));

		await listPullRequests(creds, ref, {
			state: "all",
			limit: 30,
			author: { kind: "nickname", value: "alice" },
		});

		expect(calls[0]?.getAll("state")).toEqual([]);
		expect(calls[0]?.get("q")).toBe(
			'(state="OPEN" OR state="MERGED" OR state="DECLINED" OR state="SUPERSEDED") AND author.nickname="alice"',
		);
	});

	test("follows next cursor until limit reached", async () => {
		const calls = captureListRequests(({ url }) => {
			const page = new URL(url).searchParams.get("page") ?? "1";
			const values =
				page === "1"
					? [makePr({ id: 1 }), makePr({ id: 2 })]
					: [makePr({ id: 3 }), makePr({ id: 4 })];
			const next =
				page === "1"
					? `${PR_LIST_PATH}?page=2&state=OPEN&sort=-updated_on&pagelen=50`
					: undefined;
			return HttpResponse.json({ values, next });
		});

		const result = await listPullRequests(creds, ref, {
			state: "open",
			limit: 3,
		});

		expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
		expect(calls).toHaveLength(2);
		expect(calls[1]?.get("page")).toBe("2");
	});

	test("stops paging when Bitbucket omits next even if under limit", async () => {
		const calls = captureListRequests(({ url }) => {
			const page = new URL(url).searchParams.get("page") ?? "1";
			if (page === "1") {
				return HttpResponse.json({
					values: [makePr({ id: 1 }), makePr({ id: 2 })],
					next: `${PR_LIST_PATH}?page=2`,
				});
			}
			return HttpResponse.json({ values: [makePr({ id: 3 })] });
		});

		const result = await listPullRequests(creds, ref, {
			state: "open",
			limit: 100,
		});

		expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
		expect(calls).toHaveLength(2);
	});

	test("next cursor preserves repeated state params and sort", async () => {
		const calls = captureListRequests(({ url }) => {
			const page = new URL(url).searchParams.get("page");
			if (!page) {
				return HttpResponse.json({
					values: [makePr({ id: 1 })],
					next: `${PR_LIST_PATH}?page=2&state=OPEN&state=MERGED&sort=-updated_on`,
				});
			}
			return HttpResponse.json({ values: [] });
		});

		await listPullRequests(creds, ref, { state: "all", limit: 100 });

		expect(calls[1]?.getAll("state")).toEqual(["OPEN", "MERGED"]);
		expect(calls[1]?.get("sort")).toBe("-updated_on");
		expect(calls[1]?.get("page")).toBe("2");
	});

	test("maps API fields to summary shape", async () => {
		server.use(
			http.get(PR_LIST_PATH, () =>
				HttpResponse.json({
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
							links: {
								html: { href: "https://bitbucket.org/ws/repo/pull-requests/7" },
							},
						}),
					],
				}),
			),
		);

		const result = await listPullRequests(creds, ref, {
			state: "all",
			limit: 10,
		});

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
		server.use(
			http.get(PR_LIST_PATH, () =>
				HttpResponse.json({ values: [makePr({ id: 9, author: null })] }),
			),
		);

		const result = await listPullRequests(creds, ref, {
			state: "all",
			limit: 10,
		});

		expect(result[0]?.author).toBeNull();
	});

	test("throws PullRequestError on non-ok response", async () => {
		server.use(
			http.get(PR_LIST_PATH, () =>
				HttpResponse.json({ type: "error" }, { status: 404 }),
			),
		);

		const err = await listPullRequests(creds, ref, {
			state: "open",
			limit: 30,
		}).catch((e) => e);

		expect(err).toBeInstanceOf(PullRequestError);
		expect((err as PullRequestError).status).toBe(404);
	});
});

describe("getPullRequest", () => {
	test("fetches and maps a single PR to PullRequestDetail", async () => {
		let seenPath = null as string | null;
		server.use(
			http.get(PR_DETAIL_PATH(42), ({ request }) => {
				seenPath = new URL(request.url).pathname;
				return HttpResponse.json(makePrDetail());
			}),
		);

		const result = await getPullRequest(creds, ref, 42);

		expect(seenPath!).toBe("/2.0/repositories/ws/repo/pullrequests/42");

		expect(result).toEqual<PullRequestDetail>({
			id: 42,
			title: "Rework auth",
			state: "OPEN",
			author: { uuid: "{alice}", displayName: "Alice", nickname: "alice" },
			createdOn: "2026-04-10T00:00:00Z",
			updatedOn: "2026-04-13T00:00:00Z",
			url: "https://bitbucket.org/ws/repo/pull-requests/42",
			description:
				"A detailed PR description.\n\n- fix thing\n- fix other thing",
			sourceBranch: "feature/auth",
			destinationBranch: "main",
			reviewers: [
				{
					account: { uuid: "{bob}", displayName: "Bob", nickname: "bob" },
					state: "approved",
				},
				{
					account: { uuid: "{carol}", displayName: "Carol", nickname: "carol" },
					state: "changes_requested",
				},
				{
					account: { uuid: "{dave}", displayName: "Dave", nickname: "dave" },
					state: "pending",
				},
			],
		});
	});

	test("throws PullRequestError on 404", async () => {
		server.use(
			http.get(PR_DETAIL_PATH(99), () =>
				HttpResponse.json({ type: "error" }, { status: 404 }),
			),
		);

		const err = await getPullRequest(creds, ref, 99).catch((e) => e);
		expect(err).toBeInstanceOf(PullRequestError);
		expect((err as PullRequestError).status).toBe(404);
	});

	test("handles a PR with no participants", async () => {
		server.use(
			http.get(PR_DETAIL_PATH(42), () =>
				HttpResponse.json(makePrDetail({ participants: undefined })),
			),
		);

		const result = await getPullRequest(creds, ref, 42);
		expect(result.reviewers).toEqual([]);
	});
});

describe("findOpenPullRequestForBranch", () => {
	test("queries with BBQL filter on source branch and open state", async () => {
		const calls = captureListRequests(() =>
			HttpResponse.json({ values: [makePrDetail({ id: 7 })] }),
		);

		const result = await findOpenPullRequestForBranch(
			creds,
			ref,
			"feature/auth",
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.get("q")).toBe(
			'state="OPEN" AND source.branch.name="feature/auth"',
		);
		expect(calls[0]?.get("pagelen")).toBe("1");
		expect(result?.id).toBe(7);
	});

	test("returns null when no open PR matches", async () => {
		server.use(http.get(PR_LIST_PATH, () => HttpResponse.json({ values: [] })));

		const result = await findOpenPullRequestForBranch(
			creds,
			ref,
			"feature/auth",
		);
		expect(result).toBeNull();
	});

	test("escapes quotes in branch names", async () => {
		const calls = captureListRequests(() => HttpResponse.json({ values: [] }));

		await findOpenPullRequestForBranch(creds, ref, 'weird"branch');

		expect(calls[0]?.get("q")).toBe(
			'state="OPEN" AND source.branch.name="weird\\"branch"',
		);
	});
});

describe("createPullRequest", () => {
	test("POSTs title, description, and source/destination branches", async () => {
		let seenBody: Record<string, any> | null = null;
		server.use(
			http.post(PR_LIST_PATH, async ({ request }) => {
				seenBody = (await request.json()) as Record<string, any>;
				return HttpResponse.json(
					makePrDetail({ id: 100, title: "Add login" }),
					{ status: 201 },
				);
			}),
		);

		const result = await createPullRequest(creds, ref, {
			title: "Add login",
			description: "Wires up auth middleware.",
			sourceBranch: "feature/login",
			destinationBranch: "main",
		});

		expect(seenBody!).toEqual({
			type: "pullrequest",
			title: "Add login",
			description: "Wires up auth middleware.",
			source: { branch: { name: "feature/login" } },
			destination: { branch: { name: "main" } },
		});
		expect(result.id).toBe(100);
		expect(result.title).toBe("Add login");
	});

	test("omits the draft field when draft option is absent", async () => {
		let seenBody: Record<string, any> | null = null;
		server.use(
			http.post(PR_LIST_PATH, async ({ request }) => {
				seenBody = (await request.json()) as Record<string, any>;
				return HttpResponse.json(makePrDetail({ id: 101 }), { status: 201 });
			}),
		);

		await createPullRequest(creds, ref, {
			title: "no draft",
			description: "",
			sourceBranch: "feature/x",
			destinationBranch: "main",
		});

		expect(seenBody!).not.toHaveProperty("draft");
	});

	test("omits the draft field when draft is false", async () => {
		// Explicit false should still be omitted — we rely on the server default.
		let seenBody: Record<string, any> | null = null;
		server.use(
			http.post(PR_LIST_PATH, async ({ request }) => {
				seenBody = (await request.json()) as Record<string, any>;
				return HttpResponse.json(makePrDetail({ id: 102 }), { status: 201 });
			}),
		);

		await createPullRequest(creds, ref, {
			title: "explicit false",
			description: "",
			sourceBranch: "feature/x",
			destinationBranch: "main",
			draft: false,
		});

		expect(seenBody!).not.toHaveProperty("draft");
	});

	test("sends draft: true when draft option is set", async () => {
		let seenBody: Record<string, any> | null = null;
		server.use(
			http.post(PR_LIST_PATH, async ({ request }) => {
				seenBody = (await request.json()) as Record<string, any>;
				return HttpResponse.json(makePrDetail({ id: 103 }), { status: 201 });
			}),
		);

		await createPullRequest(creds, ref, {
			title: "draft PR",
			description: "",
			sourceBranch: "feature/x",
			destinationBranch: "main",
			draft: true,
		});

		expect(seenBody!.draft).toBe(true);
	});

	test("omits the reviewers field when reviewerUuids is undefined", async () => {
		let seenBody: Record<string, any> | null = null;
		server.use(
			http.post(PR_LIST_PATH, async ({ request }) => {
				seenBody = (await request.json()) as Record<string, any>;
				return HttpResponse.json(makePrDetail({ id: 110 }), { status: 201 });
			}),
		);

		await createPullRequest(creds, ref, {
			title: "no reviewers",
			description: "",
			sourceBranch: "feature/x",
			destinationBranch: "main",
		});

		expect(seenBody!).not.toHaveProperty("reviewers");
	});

	test("omits the reviewers field when reviewerUuids is empty", async () => {
		let seenBody: Record<string, any> | null = null;
		server.use(
			http.post(PR_LIST_PATH, async ({ request }) => {
				seenBody = (await request.json()) as Record<string, any>;
				return HttpResponse.json(makePrDetail({ id: 111 }), { status: 201 });
			}),
		);

		await createPullRequest(creds, ref, {
			title: "empty reviewers",
			description: "",
			sourceBranch: "feature/x",
			destinationBranch: "main",
			reviewerUuids: [],
		});

		expect(seenBody!).not.toHaveProperty("reviewers");
	});

	test("sends reviewers as [{type:'account', uuid}] when reviewerUuids is non-empty", async () => {
		let seenBody: Record<string, any> | null = null;
		server.use(
			http.post(PR_LIST_PATH, async ({ request }) => {
				seenBody = (await request.json()) as Record<string, any>;
				return HttpResponse.json(makePrDetail({ id: 112 }), { status: 201 });
			}),
		);

		await createPullRequest(creds, ref, {
			title: "with reviewers",
			description: "",
			sourceBranch: "feature/x",
			destinationBranch: "main",
			reviewerUuids: ["{alice}", "{bob}"],
		});

		expect(seenBody!.reviewers).toEqual([
			{ type: "account", uuid: "{alice}" },
			{ type: "account", uuid: "{bob}" },
		]);
	});

	test("throws PullRequestError on 400 (validation failure)", async () => {
		server.use(
			http.post(PR_LIST_PATH, () =>
				HttpResponse.json(
					{ type: "error", error: { message: "Invalid source branch" } },
					{ status: 400 },
				),
			),
		);

		const err = await createPullRequest(creds, ref, {
			title: "x",
			description: "",
			sourceBranch: "nope",
			destinationBranch: "main",
		}).catch((e) => e);

		expect(err).toBeInstanceOf(PullRequestError);
		expect((err as PullRequestError).status).toBe(400);
	});
});

describe("listEffectiveDefaultReviewers", () => {
	const PATH = `${BITBUCKET_BASE}/repositories/ws/repo/effective-default-reviewers`;

	test("returns uuids in document order, skipping entries without one", async () => {
		server.use(
			http.get(PATH, () =>
				HttpResponse.json({
					values: [
						{
							type: "default_reviewer_and_type",
							reviewer_type: "repository",
							user: { uuid: "{alice}", nickname: "alice" },
						},
						{
							type: "default_reviewer_and_type",
							reviewer_type: "project",
							user: { uuid: "{bob}", nickname: "bob" },
						},
						// pathological: missing user → skip silently
						{ type: "default_reviewer_and_type", reviewer_type: "project" },
						// pathological: empty uuid → skip silently
						{
							type: "default_reviewer_and_type",
							reviewer_type: "project",
							user: { uuid: "", nickname: "ghost" },
						},
					],
				}),
			),
		);

		const out = await listEffectiveDefaultReviewers(creds, ref);
		expect(out).toEqual(["{alice}", "{bob}"]);
	});

	test("empty list when no defaults configured", async () => {
		server.use(http.get(PATH, () => HttpResponse.json({ values: [] })));

		const out = await listEffectiveDefaultReviewers(creds, ref);
		expect(out).toEqual([]);
	});

	test("treats missing values array as empty", async () => {
		server.use(http.get(PATH, () => HttpResponse.json({})));

		const out = await listEffectiveDefaultReviewers(creds, ref);
		expect(out).toEqual([]);
	});

	test("throws PullRequestError on 403", async () => {
		server.use(
			http.get(PATH, () =>
				HttpResponse.json({ type: "error" }, { status: 403 }),
			),
		);

		const err = await listEffectiveDefaultReviewers(creds, ref).catch((e) => e);
		expect(err).toBeInstanceOf(PullRequestError);
		expect((err as PullRequestError).status).toBe(403);
	});
});

describe("createPullRequestComment", () => {
	const COMMENTS_PATH = (id: number) =>
		`${BITBUCKET_BASE}/repositories/ws/repo/pullrequests/${id}/comments`;

	test("POSTs body and markup=markdown, returns id and html url", async () => {
		let seenBody: Record<string, any> | null = null;
		server.use(
			http.post(COMMENTS_PATH(42), async ({ request }) => {
				seenBody = (await request.json()) as Record<string, any>;
				return HttpResponse.json(
					{
						type: "pullrequest_comment",
						id: 7,
						content: {
							raw: "hello",
							markup: "markdown",
							html: "<p>hello</p>",
						},
						links: {
							html: {
								href: "https://bitbucket.org/ws/repo/pull-requests/42/_#comment-7",
							},
						},
					},
					{ status: 201 },
				);
			}),
		);

		const out = await createPullRequestComment(creds, ref, 42, "hello");

		expect(seenBody!).toEqual({
			type: "pullrequest_comment",
			content: { raw: "hello", markup: "markdown" },
		});
		expect(out).toEqual({
			id: 7,
			url: "https://bitbucket.org/ws/repo/pull-requests/42/_#comment-7",
		});
	});

	test("throws PullRequestError on 403", async () => {
		server.use(
			http.post(COMMENTS_PATH(42), () =>
				HttpResponse.json({ type: "error" }, { status: 403 }),
			),
		);

		const err = await createPullRequestComment(creds, ref, 42, "nope").catch(
			(e) => e,
		);
		expect(err).toBeInstanceOf(PullRequestError);
		expect((err as PullRequestError).status).toBe(403);
	});

	test("throws PullRequestError on 404", async () => {
		server.use(
			http.post(COMMENTS_PATH(99), () =>
				HttpResponse.json({ type: "error" }, { status: 404 }),
			),
		);

		const err = await createPullRequestComment(creds, ref, 99, "nope").catch(
			(e) => e,
		);
		expect(err).toBeInstanceOf(PullRequestError);
		expect((err as PullRequestError).status).toBe(404);
	});
});
