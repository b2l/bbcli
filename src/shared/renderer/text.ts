import Table from "cli-table3";
import pc from "picocolors";
import type {
  Column,
  Field,
  Renderer,
  Style,
} from "./types.ts";

/**
 * gh-style borderless config for cli-table3: no box-drawing characters, no
 * padding on cell edges. Column separator is two spaces (via `middle`), which
 * matches the original hand-rolled layout.
 */
const BORDERLESS_CHARS = {
  top: "", "top-mid": "", "top-left": "", "top-right": "",
  bottom: "", "bottom-mid": "", "bottom-left": "", "bottom-right": "",
  left: "", "left-mid": "", mid: "", "mid-mid": "",
  right: "", "right-mid": "", middle: "  ",
};

const BORDERLESS_STYLE = {
  "padding-left": 0,
  "padding-right": 0,
  head: [] as string[],
  border: [] as string[],
};

type Streams = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

const defaultStreams: Streams = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function trimTrailing(line: string): string {
  return line.replace(/\s+$/, "");
}

function applyStyle(style: Style | undefined, text: string): string {
  switch (style) {
    case "muted":
      return pc.gray(text);
    case "bold":
      return pc.bold(text);
    case "success":
      return pc.green(text);
    case "failure":
      return pc.red(text);
    case "default":
    case undefined:
      return text;
  }
}

export function createTextRenderer(streams: Streams = defaultStreams): Renderer {
  return {
    message(text) {
      streams.stdout(text + "\n");
    },

    error(text) {
      streams.stderr(pc.red("error:") + " " + text + "\n");
    },

    list<T>(items: T[], columns: Column<T>[]) {
      if (items.length === 0) return;

      const table = new Table({
        head: columns.map((c) => pc.bold(c.header)),
        chars: { ...BORDERLESS_CHARS },
        style: { ...BORDERLESS_STYLE },
      });

      for (const item of items) {
        table.push(
          columns.map((c) => applyStyle(c.style, c.value(item))),
        );
      }

      // cli-table3 pads the last column, leaving trailing whitespace per line.
      // Match gh's output style by stripping it.
      const output = table.toString().split("\n").map(trimTrailing).join("\n");
      streams.stdout(output + "\n");
    },

    detail<T>(item: T, fields: Field<T>[]) {
      const labelWidth = Math.max(...fields.map((f) => f.label.length));
      for (const field of fields) {
        const label = pc.bold(field.label.padEnd(labelWidth)) + ":";
        const value = applyStyle(field.style, field.value(item));
        streams.stdout(`${label} ${value}\n`);
      }
    },
  };
}
