import { describe, expect, test } from "bun:test";
import { resolveWorkspace, WorkspaceResolutionError } from "./resolve.ts";

const noRepo = async () => undefined;
const noWorkspaces = async () => [] as string[];
const oneWorkspace = async () => ["my-ws"];
const multipleWorkspaces = async () => ["ws-a", "ws-b", "ws-c"];
const repoWorkspace = async () => "detected-ws";

describe("resolveWorkspace", () => {
	test("returns override when provided", async () => {
		const result = await resolveWorkspace("explicit-ws", noRepo, noWorkspaces);
		expect(result).toBe("explicit-ws");
	});

	test("extracts first segment from workspace/repo override", async () => {
		const result = await resolveWorkspace(
			"my-ws/my-repo",
			noRepo,
			noWorkspaces,
		);
		expect(result).toBe("my-ws");
	});

	test("does not call detectFromRepo or fetchWorkspaceSlugs when override is set", async () => {
		let repoCalled = false;
		let wsCalled = false;

		await resolveWorkspace(
			"explicit",
			async () => {
				repoCalled = true;
				return undefined;
			},
			async () => {
				wsCalled = true;
				return [];
			},
		);

		expect(repoCalled).toBe(false);
		expect(wsCalled).toBe(false);
	});

	test("falls back to current repo workspace", async () => {
		const result = await resolveWorkspace(
			undefined,
			repoWorkspace,
			noWorkspaces,
		);
		expect(result).toBe("detected-ws");
	});

	test("does not call fetchWorkspaceSlugs when repo detection succeeds", async () => {
		let wsCalled = false;

		await resolveWorkspace(undefined, repoWorkspace, async () => {
			wsCalled = true;
			return [];
		});

		expect(wsCalled).toBe(false);
	});

	test("auto-selects sole workspace when repo detection fails", async () => {
		const result = await resolveWorkspace(undefined, noRepo, oneWorkspace);
		expect(result).toBe("my-ws");
	});

	test("throws when no workspaces exist", async () => {
		const err = await resolveWorkspace(undefined, noRepo, noWorkspaces).catch(
			(e) => e,
		);

		expect(err).toBeInstanceOf(WorkspaceResolutionError);
		expect(err.message).toBe("No workspaces found for your account.");
	});

	test("throws with workspace list when multiple exist", async () => {
		const err = await resolveWorkspace(
			undefined,
			noRepo,
			multipleWorkspaces,
		).catch((e) => e);

		expect(err).toBeInstanceOf(WorkspaceResolutionError);
		expect(err.message).toContain("Multiple workspaces available");
		expect(err.message).toContain("ws-a");
		expect(err.message).toContain("ws-b");
		expect(err.message).toContain("ws-c");
	});

	test("propagates errors from detectFromRepo", async () => {
		const err = await resolveWorkspace(
			undefined,
			async () => {
				throw new Error("git exploded");
			},
			noWorkspaces,
		).catch((e) => e);

		expect(err.message).toBe("git exploded");
	});

	test("propagates errors from fetchWorkspaceSlugs", async () => {
		const err = await resolveWorkspace(undefined, noRepo, async () => {
			throw new Error("API down");
		}).catch((e) => e);

		expect(err.message).toBe("API down");
	});
});
