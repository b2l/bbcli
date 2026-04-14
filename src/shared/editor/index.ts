import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class EditorError extends Error {
  override name = "EditorError";
}

/**
 * Launches the user's editor on a temporary file (optionally pre-filled with
 * `initialContents`) and returns whatever they wrote on exit. Picks the
 * editor from `$VISUAL`, then `$EDITOR`; throws when neither is set.
 *
 * stdio is inherited so the editor takes over the terminal (as expected for
 * vim/nvim/nano/etc.). On non-zero exit the tempfile is still cleaned up.
 */
export async function openEditor(initialContents = ""): Promise<string> {
  const raw = process.env["VISUAL"] ?? process.env["EDITOR"];
  if (!raw || !raw.trim()) {
    throw new EditorError(
      "No editor configured. Set $VISUAL or $EDITOR (e.g. export EDITOR=nvim).",
    );
  }

  // Env var may carry args (`code --wait`, `nvim -c 'set ft=markdown'`), so
  // split on whitespace rather than exec'ing the whole string as one binary.
  // This doesn't honor shell quoting, but matches how git and gh parse it.
  const [exe, ...args] = raw.trim().split(/\s+/);

  const dir = await mkdtemp(join(tmpdir(), "bbcli-editor-"));
  const path = join(dir, "message.md");

  try {
    await Bun.write(path, initialContents);

    const proc = Bun.spawn([exe!, ...args, path], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new EditorError(
        `Editor (${raw}) exited with code ${exitCode}.`,
      );
    }

    return await Bun.file(path).text();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
