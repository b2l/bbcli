import type { Renderer } from "./types.ts";

type Streams = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

const defaultStreams: Streams = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

/**
 * JSON renderer: dumps raw objects/arrays to stdout, suppresses info messages,
 * and writes errors as plain text to stderr (scripts inspect exit codes, not
 * the shape of error output).
 */
export function createJsonRenderer(streams: Streams = defaultStreams): Renderer {
  return {
    message() {
      // Info output is noise in a JSON pipeline — swallow it.
    },

    error(text) {
      streams.stderr(text + "\n");
    },

    list(items) {
      streams.stdout(JSON.stringify(items) + "\n");
    },

    detail(item) {
      streams.stdout(JSON.stringify(item) + "\n");
    },
  };
}
