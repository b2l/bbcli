import {
	getPullRequestDiff,
	PullRequestError,
} from "../../backend/pullrequests/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import {
	RepositoryResolutionError,
	resolveRepository,
} from "../../shared/repository/index.ts";
import { resolveCurrentPullRequestId } from "./current.ts";

export type PullRequestDiffOptions = {
	repository?: string;
};

export async function runPullRequestDiff(
	renderer: Renderer,
	idArg: string | undefined,
	options: PullRequestDiffOptions,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	try {
		const ref = await resolveRepository({ override: options.repository });
		const id = await resolveCurrentPullRequestId(idArg, {
			renderer,
			config,
			ref,
			commandName: "diff",
		});

		const diff = await getPullRequestDiff(config, ref, id);

		if (renderer.json) {
			renderer.detail({ diff }, []);
			return;
		}
		// Text mode: write the diff verbatim so pipes to `less` / `delta`
		// work. No trailing newline added — the diff itself already ends
		// with one when non-empty.
		process.stdout.write(diff);
	} catch (err) {
		if (
			err instanceof RepositoryResolutionError ||
			err instanceof PullRequestError
		) {
			renderer.error(err.message);
			process.exit(1);
		}
		throw err;
	}
}
