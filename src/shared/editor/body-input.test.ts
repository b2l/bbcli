import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BodyInputError, resolveBodyInput } from "./body-input.ts";

describe("resolveBodyInput", () => {
	test("--body wins outright", async () => {
		const out = await resolveBodyInput({
			body: "literal",
			bodyFile: "ignored",
		});
		expect(out).toBe("literal");
	});

	test("empty --body is still returned (empty is a valid input here)", async () => {
		const out = await resolveBodyInput({ body: "" });
		expect(out).toBe("");
	});

	test("--body-file reads the file contents", async () => {
		const dir = await mkdtemp(join(tmpdir(), "bbcli-body-input-"));
		const path = join(dir, "body.md");
		await Bun.write(path, "from file\n");
		try {
			const out = await resolveBodyInput({ bodyFile: path });
			expect(out).toBe("from file\n");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("missing --body-file throws BodyInputError with the path in the message", async () => {
		const err = await resolveBodyInput({
			bodyFile: "/definitely/does/not/exist.md",
		}).catch((e) => e);
		expect(err).toBeInstanceOf(BodyInputError);
		expect((err as Error).message).toContain("/definitely/does/not/exist.md");
	});

	// Note: we don't unit-test `--body-file -` (stdin) or the editor fallback
	// here — Bun.stdin.text() and the editor subprocess are owned by their own
	// integration paths. Adding fakes for either would outweigh the value.
});
