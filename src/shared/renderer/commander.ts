import type { Command } from "commander";
import { createRenderer } from "./index.ts";
import type { Renderer } from "./types.ts";

/**
 * Wraps a command action so it receives a Renderer built from the root
 * program's `--json` flag. The wrapper is the commander action; `runner`
 * is the command logic we want to keep free of commander noise.
 */
export function withRenderer(
  runner: (renderer: Renderer) => Promise<void> | void,
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    const json = Boolean(cmd.optsWithGlobals().json);
    await runner(createRenderer({ json }));
  };
}
