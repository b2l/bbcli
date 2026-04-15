import Table from "cli-table3";
import pc from "picocolors";
import type { Column, Field, Renderer, Style } from "./types.ts";

/**
 * gh-style borderless config for cli-table3: no box-drawing characters, no
 * padding on cell edges. Column separator is two spaces (via `middle`), which
 * matches the original hand-rolled layout.
 */
const BORDERLESS_CHARS = {
	top: "",
	"top-mid": "",
	"top-left": "",
	"top-right": "",
	bottom: "",
	"bottom-mid": "",
	"bottom-left": "",
	"bottom-right": "",
	left: "",
	"left-mid": "",
	mid: "",
	"mid-mid": "",
	right: "",
	"right-mid": "",
	middle: "  ",
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
	/**
	 * Terminal width in columns. `undefined` means don't truncate — either
	 * stdout isn't a TTY (piped output should preserve full text) or the
	 * caller doesn't know the width.
	 */
	terminalWidth?: number | undefined;
};

const defaultStreams: Streams = {
	stdout: (s) => process.stdout.write(s),
	stderr: (s) => process.stderr.write(s),
	terminalWidth: process.stdout.isTTY ? process.stdout.columns : undefined,
};

const COLUMN_GAP = 2;
const MIN_FLEX_WIDTH = 10;

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

export function createTextRenderer(
	streams: Streams = defaultStreams,
): Renderer {
	return {
		message(text) {
			streams.stdout(`${text}\n`);
		},

		error(text) {
			streams.stderr(`${pc.red("error:")} ${text}\n`);
		},

		list<T>(items: T[], columns: Column<T>[]) {
			if (items.length === 0) return;

			const colWidths = computeColWidths(items, columns, streams.terminalWidth);

			const table = new Table({
				head: columns.map((c) => pc.bold(c.header)),
				chars: { ...BORDERLESS_CHARS },
				style: { ...BORDERLESS_STYLE },
				// cli-table3 reads colWidths[i] for every cell and crashes if the
				// option is set but undefined — only pass the property when sized.
				...(colWidths ? { colWidths } : {}),
			});

			for (const item of items) {
				table.push(columns.map((c) => applyStyle(c.style, c.value(item))));
			}

			// cli-table3 pads the last column, leaving trailing whitespace per line.
			// Match gh's output style by stripping it.
			const output = table.toString().split("\n").map(trimTrailing).join("\n");
			streams.stdout(`${output}\n`);
		},

		detail<T>(item: T, fields: Field<T>[]) {
			// detail is label-per-line; terminal width doesn't affect layout here.
			const labelWidth = Math.max(...fields.map((f) => f.label.length));
			for (const field of fields) {
				const label = `${pc.bold(field.label.padEnd(labelWidth))}:`;
				const value = applyStyle(field.style, field.value(item));
				streams.stdout(`${label} ${value}\n`);
			}
		},
	};
}

/**
 * Returns a `colWidths` array for cli-table3. If the natural width of the
 * table fits inside `terminalWidth` (or `terminalWidth` is undefined, i.e.
 * not a TTY), returns `undefined` so cli-table3 uses its natural sizing.
 * Otherwise, shrinks the first `flex: true` column until the row fits —
 * cli-table3 truncates the content with `…`.
 */
function computeColWidths<T>(
	items: T[],
	columns: Column<T>[],
	terminalWidth: number | undefined,
): number[] | undefined {
	if (terminalWidth === undefined) return undefined;

	const natural = columns.map((c) => {
		let max = visualLength(c.header);
		for (const item of items) {
			const len = visualLength(c.value(item));
			if (len > max) max = len;
		}
		return max;
	});

	const total =
		natural.reduce((a, b) => a + b, 0) + COLUMN_GAP * (columns.length - 1);
	if (total <= terminalWidth) return undefined;

	const flexIdx = columns.findIndex((c) => c.flex);
	if (flexIdx === -1) return undefined;

	const over = total - terminalWidth;
	const widths = [...natural];
	widths[flexIdx] = Math.max(MIN_FLEX_WIDTH, widths[flexIdx]! - over);
	return widths;
}

/**
 * Character width ignoring ANSI escapes. Values are unstyled by this point
 * (style is applied per cell later), but headers are `pc.bold(...)` which
 * may or may not inject escapes depending on TTY detection.
 */
function visualLength(s: string): number {
	return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}
