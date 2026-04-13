import type { Command } from "commander";
import { createRenderer } from "./index.ts";
import type { Renderer } from "./types.ts";

/**
 * Builds a Renderer from a commander Command, honoring the root program's
 * `--json` flag.
 */
export function rendererFrom(cmd: Command): Renderer {
  const json = Boolean(cmd.optsWithGlobals().json);
  return createRenderer({ json });
}

/**
 * Adapts a `(renderer, ...rest)` runner into a commander action. Commander
 * passes `(arg1, ..., options, command)`; we strip the trailing command,
 * build a renderer from it, and forward the rest to the runner. TS infers
 * the runner's remaining parameter tuple so callers don't annotate options
 * at the registration site.
 */
export function withRenderer<A extends unknown[]>(
  runner: (renderer: Renderer, ...rest: A) => void | Promise<void>,
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    const rest = args.slice(0, -1) as A;
    await runner(rendererFrom(cmd), ...rest);
  };
}
