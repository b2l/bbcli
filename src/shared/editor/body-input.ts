import { openEditor } from "./index.ts";

export class BodyInputError extends Error {
	override name = "BodyInputError";
}

export type BodyInputOptions = {
	/** `--body "text"` — literal string wins over everything. */
	body?: string;
	/** `--body-file <path>` — read from disk. Use "-" for stdin. */
	bodyFile?: string;
	/** When falling through to the editor, pre-fill the buffer with this. */
	editorInitial?: string;
};

/**
 * Resolves a user-supplied text body from CLI flags, stdin, or the user's
 * `$EDITOR`. Shared between `bb pr create`, `bb pr comment`, and any future
 * command that takes a free-form body.
 *
 * Precedence:
 *   1. `--body` (literal)
 *   2. `--body-file` (path, or `-` for stdin)
 *   3. `$EDITOR` with an optional pre-fill
 *
 * The command layer is responsible for rejecting empty output when empty
 * isn't meaningful (e.g. a comment). This helper returns whatever was typed.
 */
export async function resolveBodyInput(
	options: BodyInputOptions,
): Promise<string> {
	if (options.body !== undefined) return options.body;

	if (options.bodyFile !== undefined) {
		if (options.bodyFile === "-") return await Bun.stdin.text();

		const file = Bun.file(options.bodyFile);
		if (!(await file.exists())) {
			throw new BodyInputError(
				`--body-file '${options.bodyFile}' does not exist.`,
			);
		}
		return await file.text();
	}

	return await openEditor(options.editorInitial ?? "");
}
