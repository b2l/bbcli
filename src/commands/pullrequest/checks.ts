import {
	type CommitStatus,
	type CommitStatusState,
	listPullRequestStatuses,
	PullRequestError,
} from "../../backend/pullrequests/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";
import {
	RepositoryResolutionError,
	resolveRepository,
} from "../../shared/repository/index.ts";
import { resolveCurrentPullRequestId } from "./current.ts";

export type PullRequestChecksOptions = {
	repository?: string;
};

type Summary = { passed: number; failed: number; pending: number };

const STATE_ICON: Record<CommitStatusState, string> = {
	SUCCESSFUL: "\u2713", // ✓
	FAILED: "\u2717", // ✗
	INPROGRESS: "*",
	STOPPED: "\u2717", // ✗
};

export async function runPullRequestChecks(
	renderer: Renderer,
	idArg: string | undefined,
	options: PullRequestChecksOptions,
): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	try {
		const ref = await resolveRepository({ override: options.repository });
		const id = await resolveCurrentPullRequestId(idArg, {
			renderer,
			config,
			ref,
			commandName: "checks",
		});

		const statuses = await listPullRequestStatuses(config, ref, id);
		const summary = summarize(statuses);

		if (renderer.json) {
			renderer.detail({ checks: statuses, summary }, []);
			return;
		}

		if (statuses.length === 0) {
			renderer.message("No CI checks reported for this pull request.");
			process.exit(0);
		}

		renderer.list(statuses, [
			{
				header: "",
				value: (s) => `${STATE_ICON[s.state]}`,
				style: undefined,
			},
			{ header: "NAME", value: (s) => s.name, flex: true },
			{ header: "DESCRIPTION", value: (s) => s.description, style: "muted" },
			{ header: "URL", value: (s) => s.url, style: "muted" },
		]);

		renderer.message(
			`${summary.passed} passed, ${summary.failed} failed, ${summary.pending} pending`,
		);

		process.exit(exitCode(summary));
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

function summarize(statuses: CommitStatus[]): Summary {
	let passed = 0;
	let failed = 0;
	let pending = 0;
	for (const s of statuses) {
		if (s.state === "SUCCESSFUL") passed++;
		else if (s.state === "FAILED" || s.state === "STOPPED") failed++;
		else pending++;
	}
	return { passed, failed, pending };
}

/**
 * Exit codes per the spec:
 * - 0: all SUCCESSFUL (or empty)
 * - 1: any FAILED or STOPPED
 * - 2: any INPROGRESS with no failures
 */
function exitCode(summary: Summary): number {
	if (summary.failed > 0) return 1;
	if (summary.pending > 0) return 2;
	return 0;
}
