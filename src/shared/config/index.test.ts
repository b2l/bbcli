import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ConfigError, loadConfig } from "./index.ts";

const fixturesDir = join(import.meta.dir, "fixtures");
const fixture = (name: string) => join(fixturesDir, name);
const stripPath = (msg: string) => msg.replaceAll(`${fixturesDir}/`, "");

async function expectConfigError(fixtureName: string): Promise<string> {
	const err = await loadConfig(fixture(fixtureName)).catch((e) => e);
	expect(err).toBeInstanceOf(ConfigError);
	return stripPath((err as ConfigError).message);
}

describe("loadConfig", () => {
	// --- happy paths ---

	test("loads plaintext token", async () => {
		const cfg = await loadConfig(fixture("valid-token.json"));
		expect(cfg).toMatchInlineSnapshot(`
      {
        "email": "alice@example.com",
        "token": "test-token",
      }
    `);
	});

	test("resolves token via token_command and trims trailing whitespace", async () => {
		const cfg = await loadConfig(fixture("valid-command.json"));
		expect(cfg).toMatchInlineSnapshot(`
      {
        "email": "alice@example.com",
        "token": "from-command",
      }
    `);
	});

	// --- config file errors ---

	test("rejects missing config file", async () => {
		const msg = await expectConfigError("does-not-exist.json");
		expect(msg).toMatchInlineSnapshot(
			`"No config file found at does-not-exist.json."`,
		);
	});

	test("rejects malformed JSON", async () => {
		const msg = await expectConfigError("not-valid.txt");
		expect(msg).toMatchInlineSnapshot(`"not-valid.txt is not valid JSON."`);
	});

	// --- schema validation errors ---

	test("rejects missing email", async () => {
		const msg = await expectConfigError("missing-email.json");
		expect(msg).toMatchInlineSnapshot(`
      "Invalid config in missing-email.json: ✖ Invalid input: expected string, received undefined
        → at email"
    `);
	});

	test("rejects empty email", async () => {
		const msg = await expectConfigError("empty-email.json");
		expect(msg).toMatchInlineSnapshot(`
      "Invalid config in empty-email.json: ✖ Too small: expected string to have >=1 characters
        → at email"
    `);
	});

	test("rejects both token and token_command", async () => {
		const msg = await expectConfigError("both-set.json");
		expect(msg).toMatchInlineSnapshot(
			`"Invalid config in both-set.json: ✖ Exactly one of "token" or "token_command" must be set."`,
		);
	});

	test("rejects neither token nor token_command", async () => {
		const msg = await expectConfigError("neither-set.json");
		expect(msg).toMatchInlineSnapshot(
			`"Invalid config in neither-set.json: ✖ Exactly one of "token" or "token_command" must be set."`,
		);
	});

	test("rejects token_command with non-string elements", async () => {
		const msg = await expectConfigError("bad-command-type.json");
		expect(msg).toMatchInlineSnapshot(`
      "Invalid config in bad-command-type.json: ✖ Invalid input: expected string, received number
        → at token_command[1]"
    `);
	});

	// --- token_command execution errors ---

	test("rejects token_command that exits non-zero", async () => {
		const msg = await expectConfigError("command-exits-nonzero.json");
		expect(msg).toMatchInlineSnapshot(
			`"token_command exited with code 1: (no output)"`,
		);
	});

	test("rejects token_command that produces empty output", async () => {
		const msg = await expectConfigError("command-empty-output.json");
		expect(msg).toMatchInlineSnapshot(`"token_command produced no output."`);
	});

	test("rejects token_command with nonexistent binary", async () => {
		const err = await loadConfig(fixture("command-not-found.json")).catch(
			(e) => e,
		);
		expect(err).toBeInstanceOf(ConfigError);
	});
});
