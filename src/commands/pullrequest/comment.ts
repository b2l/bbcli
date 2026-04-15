import {
	createPullRequestComment,
	PullRequestError,
} from "../../backend/pullrequests/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import {
	BodyInputError,
	resolveBodyInput,
} from "../../shared/editor/body-input.ts";
import { EditorError } from "../../shared/editor/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import {
	RepositoryResolutionError,
	resolveRepository,
} from "../../shared/repository/index.ts";
import { resolveCurrentPullRequestId } from "./current.ts";

export type PullRequestCommentOptions = {
	repository?: string;
	body?: string;
	bodyFile?: string;
};

export async function runPullRequestComment(
	renderer: Renderer,
	idArg: string | undefined,
	options: PullRequestCommentOptions,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	if (options.body !== undefined && options.bodyFile !== undefined) {
		renderer.error("Pass either --body or --body-file, not both.");
		process.exit(1);
	}

	try {
		const ref = await resolveRepository({ override: options.repository });
		const id = await resolveCurrentPullRequestId(idArg, {
			renderer,
			config,
			ref,
			commandName: "comment",
		});

		const body = await resolveBodyInput({
			body: options.body,
			bodyFile: options.bodyFile,
		});

		if (body.trim() === "") {
			renderer.error("Comment body is empty; nothing to post.");
			process.exit(1);
		}

		const comment = await createPullRequestComment(config, ref, id, body);
		renderer.message(comment.url);
	} catch (err) {
		if (
			err instanceof RepositoryResolutionError ||
			err instanceof PullRequestError ||
			err instanceof BodyInputError ||
			err instanceof EditorError
		) {
			renderer.error(err.message);
			process.exit(1);
		}
		throw err;
	}
}
