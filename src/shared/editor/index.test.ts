import { test, expect, describe, afterEach, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEditor, EditorError } from "./index.ts";

/**
 * Integration tests. Real editors are interactive; we point `$EDITOR` at a
 * tiny shell script that mutates the tempfile and exits.
 */

let scriptDir: string;
let appendScript: string;
let visualScript: string;
let failScript: string;

beforeAll(async () => {
  scriptDir = await mkdtemp(join(tmpdir(), "bbcli-editor-test-"));

  appendScript = join(scriptDir, "append.sh");
  await Bun.write(appendScript, '#!/bin/sh\necho "hello from editor" >> "$1"\n');
  await $`chmod +x ${appendScript}`.quiet();

  visualScript = join(scriptDir, "visual.sh");
  await Bun.write(visualScript, '#!/bin/sh\necho "VISUAL_ran" >> "$1"\n');
  await $`chmod +x ${visualScript}`.quiet();

  failScript = join(scriptDir, "fail.sh");
  await Bun.write(failScript, "#!/bin/sh\nexit 2\n");
  await $`chmod +x ${failScript}`.quiet();
});

afterAll(async () => {
  if (scriptDir) await rm(scriptDir, { recursive: true, force: true });
});

const originalEditor = process.env["EDITOR"];
const originalVisual = process.env["VISUAL"];

afterEach(() => {
  if (originalEditor === undefined) delete process.env["EDITOR"];
  else process.env["EDITOR"] = originalEditor;
  if (originalVisual === undefined) delete process.env["VISUAL"];
  else process.env["VISUAL"] = originalVisual;
});

describe("openEditor", () => {
  test("invokes $EDITOR and returns the file contents after exit", async () => {
    process.env["EDITOR"] = appendScript;
    delete process.env["VISUAL"];

    const result = await openEditor("seed line\n");
    expect(result).toBe("seed line\nhello from editor\n");
  });

  test("prefers $VISUAL over $EDITOR", async () => {
    process.env["EDITOR"] = appendScript;
    process.env["VISUAL"] = visualScript;

    const result = await openEditor();
    expect(result).toContain("VISUAL_ran");
    expect(result).not.toContain("hello from editor");
  });

  test("throws EditorError when neither env var is set", async () => {
    delete process.env["EDITOR"];
    delete process.env["VISUAL"];

    const err = await openEditor().catch((e) => e);
    expect(err).toBeInstanceOf(EditorError);
  });

  test("throws EditorError when the editor exits non-zero", async () => {
    process.env["EDITOR"] = failScript;
    delete process.env["VISUAL"];

    const err = await openEditor().catch((e) => e);
    expect(err).toBeInstanceOf(EditorError);
    expect((err as Error).message).toContain("code 2");
  });
});
