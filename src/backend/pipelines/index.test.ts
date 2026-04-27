import { describe, expect, test } from "bun:test";
import { HttpResponse, http } from "msw";
import { BITBUCKET_BASE, server, setupMsw } from "../../test/msw/server.ts";
import { listPipelines, type Pipeline, PipelineError } from "./index.ts";

setupMsw();

const creds = { email: "a@b.co", token: "t" };
const ref = { workspace: "ws", slug: "repo" };

const PIPELINES_PATH = `${BITBUCKET_BASE}/repositories/ws/repo/pipelines`;

function makePipeline(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		type: "pipeline",
		uuid: "{pipe-uuid}",
		build_number: 42,
		creator: { display_name: "Alice", nickname: "alice" },
		target: {
			type: "pipeline_ref_target",
			ref_type: "branch",
			ref_name: "main",
			commit: { type: "commit", hash: "abc123def456789" },
		},
		trigger: { type: "pipeline_trigger_push" },
		state: {
			type: "pipeline_state_completed",
			name: "COMPLETED",
			result: {
				type: "pipeline_state_completed_successful",
				name: "SUCCESSFUL",
			},
		},
		created_on: "2026-04-20T10:00:00Z",
		completed_on: "2026-04-20T10:03:00Z",
		build_seconds_used: 180,
		...overrides,
	};
}

describe("listPipelines", () => {
	test("default query: sort=-created_on, pagelen=50", async () => {
		const calls: URLSearchParams[] = [];
		server.use(
			http.get(PIPELINES_PATH, ({ request }) => {
				calls.push(new URL(request.url).searchParams);
				return HttpResponse.json({ values: [makePipeline()] });
			}),
		);

		const result = await listPipelines(creds, ref, { limit: 30 });

		expect(calls).toHaveLength(1);
		expect(calls[0]?.get("sort")).toBe("-created_on");
		expect(calls[0]?.get("pagelen")).toBe("50");
		expect(result).toHaveLength(1);
		expect(result[0]?.buildNumber).toBe(42);
	});

	test("maps completed/successful pipeline to full shape", async () => {
		server.use(
			http.get(PIPELINES_PATH, () =>
				HttpResponse.json({ values: [makePipeline()] }),
			),
		);

		const result = await listPipelines(creds, ref, { limit: 10 });

		expect(result[0]).toEqual<Pipeline>({
			buildNumber: 42,
			status: "success",
			branch: "main",
			commitHash: "abc123def456",
			trigger: "push",
			creator: "Alice",
			createdOn: "2026-04-20T10:00:00Z",
			durationSeconds: 180,
		});
	});

	test("maps pending state", async () => {
		server.use(
			http.get(PIPELINES_PATH, () =>
				HttpResponse.json({
					values: [
						makePipeline({
							state: { type: "pipeline_state_pending", name: "PENDING" },
							completed_on: undefined,
						}),
					],
				}),
			),
		);

		const result = await listPipelines(creds, ref, { limit: 10 });
		expect(result[0]?.status).toBe("pending");
		expect(result[0]?.durationSeconds).toBeNull();
	});

	test("maps in-progress/running state", async () => {
		server.use(
			http.get(PIPELINES_PATH, () =>
				HttpResponse.json({
					values: [
						makePipeline({
							state: {
								type: "pipeline_state_in_progress",
								name: "IN_PROGRESS",
								stage: { name: "RUNNING" },
							},
							completed_on: undefined,
						}),
					],
				}),
			),
		);

		const result = await listPipelines(creds, ref, { limit: 10 });
		expect(result[0]?.status).toBe("running");
	});

	test("maps in-progress/paused state", async () => {
		server.use(
			http.get(PIPELINES_PATH, () =>
				HttpResponse.json({
					values: [
						makePipeline({
							state: {
								type: "pipeline_state_in_progress",
								name: "IN_PROGRESS",
								stage: { name: "PAUSED" },
							},
						}),
					],
				}),
			),
		);

		const result = await listPipelines(creds, ref, { limit: 10 });
		expect(result[0]?.status).toBe("paused");
	});

	test("maps completed/failed state", async () => {
		server.use(
			http.get(PIPELINES_PATH, () =>
				HttpResponse.json({
					values: [
						makePipeline({
							state: {
								type: "pipeline_state_completed",
								name: "COMPLETED",
								result: { name: "FAILED" },
							},
						}),
					],
				}),
			),
		);

		const result = await listPipelines(creds, ref, { limit: 10 });
		expect(result[0]?.status).toBe("failed");
	});

	test("maps completed/stopped state", async () => {
		server.use(
			http.get(PIPELINES_PATH, () =>
				HttpResponse.json({
					values: [
						makePipeline({
							state: {
								type: "pipeline_state_completed",
								name: "COMPLETED",
								result: { name: "STOPPED" },
							},
						}),
					],
				}),
			),
		);

		const result = await listPipelines(creds, ref, { limit: 10 });
		expect(result[0]?.status).toBe("stopped");
	});

	test("maps completed/error state", async () => {
		server.use(
			http.get(PIPELINES_PATH, () =>
				HttpResponse.json({
					values: [
						makePipeline({
							state: {
								type: "pipeline_state_completed",
								name: "COMPLETED",
								result: { name: "ERROR" },
							},
						}),
					],
				}),
			),
		);

		const result = await listPipelines(creds, ref, { limit: 10 });
		expect(result[0]?.status).toBe("error");
	});

	test("branch filter sends target.branch query param", async () => {
		const calls: URLSearchParams[] = [];
		server.use(
			http.get(PIPELINES_PATH, ({ request }) => {
				calls.push(new URL(request.url).searchParams);
				return HttpResponse.json({ values: [] });
			}),
		);

		await listPipelines(creds, ref, { limit: 30, branch: "develop" });

		expect(calls[0]?.get("target.branch")).toBe("develop");
	});

	test("status filter maps user-friendly name to API value", async () => {
		const calls: URLSearchParams[] = [];
		server.use(
			http.get(PIPELINES_PATH, ({ request }) => {
				calls.push(new URL(request.url).searchParams);
				return HttpResponse.json({ values: [] });
			}),
		);

		await listPipelines(creds, ref, { limit: 30, status: "failed" });

		expect(calls[0]?.get("status")).toBe("FAILED");
	});

	test("extracts trigger type from pipeline_trigger_ prefix", async () => {
		server.use(
			http.get(PIPELINES_PATH, () =>
				HttpResponse.json({
					values: [
						makePipeline({ trigger: { type: "pipeline_trigger_manual" } }),
					],
				}),
			),
		);

		const result = await listPipelines(creds, ref, { limit: 10 });
		expect(result[0]?.trigger).toBe("manual");
	});

	test("truncates commit hash to 12 chars", async () => {
		server.use(
			http.get(PIPELINES_PATH, () =>
				HttpResponse.json({
					values: [
						makePipeline({
							target: {
								ref_name: "main",
								commit: { hash: "abcdef1234567890abcdef1234567890abcdef12" },
							},
						}),
					],
				}),
			),
		);

		const result = await listPipelines(creds, ref, { limit: 10 });
		expect(result[0]?.commitHash).toBe("abcdef123456");
	});

	test("computes duration from created_on and completed_on", async () => {
		server.use(
			http.get(PIPELINES_PATH, () =>
				HttpResponse.json({
					values: [
						makePipeline({
							created_on: "2026-04-20T10:00:00Z",
							completed_on: "2026-04-20T10:02:30Z",
						}),
					],
				}),
			),
		);

		const result = await listPipelines(creds, ref, { limit: 10 });
		expect(result[0]?.durationSeconds).toBe(150);
	});

	test("falls back to nickname when display_name is missing", async () => {
		server.use(
			http.get(PIPELINES_PATH, () =>
				HttpResponse.json({
					values: [makePipeline({ creator: { nickname: "bob" } })],
				}),
			),
		);

		const result = await listPipelines(creds, ref, { limit: 10 });
		expect(result[0]?.creator).toBe("bob");
	});

	test("throws PipelineError on non-ok response", async () => {
		server.use(
			http.get(PIPELINES_PATH, () =>
				HttpResponse.json({ type: "error" }, { status: 404 }),
			),
		);

		const err = await listPipelines(creds, ref, { limit: 30 }).catch((e) => e);
		expect(err).toBeInstanceOf(PipelineError);
		expect((err as PipelineError).status).toBe(404);
	});
});
