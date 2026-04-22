import {
	getPullRequest,
	type PullRequestDetail,
	PullRequestError,
	type PullRequestState,
	updatePullRequest,
} from "../../backend/pullrequests/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import { EditorError, openEditor } from "../../shared/editor/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import {
	RepositoryResolutionError,
	resolveRepository,
} from "../../shared/repository/index.ts";
import { resolveCurrentPullRequestId } from "./current.ts";

export type PullRequestEditOptions = {
	repository?: string;
	title?: string;
	description?: string;
};

const IMMUTABLE_STATES: ReadonlySet<PullRequestState> = new Set([
	"MERGED",
	"DECLINED",
	"SUPERSEDED",
]);

/**
 * Updates a PR's title and/or description. Without flags, falls through to
 * $EDITOR pre-filled with the PR's current title (first line), a blank
 * separator, and the current description. Classic git-style message layout.
 *
 * No-op guard: if the resolved new values match the existing ones, skip
 * the PUT entirely. Saves a round trip and avoids a pointless "updated"
 * confirmation when the editor was closed without changes.
 */
export async function runPullRequestEdit(
	renderer: Renderer,
	idArg: string | undefined,
	options: PullRequestEditOptions,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	try {
		const ref = await resolveRepository({ override: options.repository });
		const id = await resolveCurrentPullRequestId(idArg, {
			renderer,
			config,
			ref,
			commandName: "edit",
		});

		const current = await getPullRequest(config, ref, id);
		if (IMMUTABLE_STATES.has(current.state)) {
			renderer.error(
				`Pull request #${id} is ${current.state.toLowerCase()}; cannot edit.`,
			);
			process.exit(1);
		}

		const resolved = await resolveFields(renderer, current, options);
		if (resolved === null) {
			renderer.message(`No changes to pull request #${id}.`);
			return;
		}

		const updated = await updatePullRequest(config, ref, id, resolved);

		if (renderer.json) {
			renderer.detail(updated, []);
		} else {
			renderer.message(`Updated pull request #${id}: ${updated.url}`);
		}
	} catch (err) {
		if (
			err instanceof RepositoryResolutionError ||
			err instanceof PullRequestError ||
			err instanceof EditorError
		) {
			renderer.error(err.message);
			process.exit(1);
		}
		throw err;
	}
}

/**
 * Resolves the fields to PUT.
 *
 * - One or both flags set → use them; only include fields that actually
 *   differ from the current PR (so e.g. `--title "same as before"` is a
 *   no-op and doesn't generate a PUT).
 * - No flags → open editor pre-filled; parse back the same way. Aborts
 *   with a clear error on empty output.
 *
 * Returns `null` when there's nothing to send (either both flags matched
 * current state, or the editor came back unchanged).
 */
async function resolveFields(
	renderer: Renderer,
	current: PullRequestDetail,
	options: PullRequestEditOptions,
): Promise<{ title?: string; description?: string } | null> {
	if (options.title !== undefined || options.description !== undefined) {
		const patch: { title?: string; description?: string } = {};
		if (options.title !== undefined && options.title !== current.title) {
			patch.title = options.title;
		}
		if (
			options.description !== undefined &&
			options.description !== current.description
		) {
			patch.description = options.description;
		}
		return Object.keys(patch).length > 0 ? patch : null;
	}

	// Editor fallback.
	const initial = `${current.title}\n\n${current.description}`;
	const raw = await openEditor(initial);
	const parsed = parseMessage(raw);
	if (parsed === null) {
		renderer.error("Edit aborted: title is empty.");
		process.exit(1);
	}

	const patch: { title?: string; description?: string } = {};
	if (parsed.title !== current.title) patch.title = parsed.title;
	if (parsed.description !== current.description) {
		patch.description = parsed.description;
	}
	return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Parses a git-style message buffer: first non-empty line is the title,
 * everything after the first blank line is the description. Returns null
 * when the title ends up empty, which the caller treats as "abort".
 *
 * Preserves trailing content verbatim so multi-paragraph descriptions
 * survive the round trip.
 */
export function parseMessage(
	raw: string,
): { title: string; description: string } | null {
	// Find the first non-empty line → that's the title. Everything after
	// the first blank line following the title is the description.
	const lines = raw.split(/\r?\n/);
	let i = 0;
	while (i < lines.length && lines[i]!.trim() === "") i++;
	if (i >= lines.length) return null;

	const title = lines[i]!.trim();
	if (!title) return null;

	// Skip the title line and any immediately following blank separator
	// lines so the description doesn't start with an empty line.
	i++;
	while (i < lines.length && lines[i]!.trim() === "") i++;

	const description = lines.slice(i).join("\n").trimEnd();
	return { title, description };
}
