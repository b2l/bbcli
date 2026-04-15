import type { Command } from "commander";
import { withRenderer } from "../../shared/renderer/commander.ts";
import { runPullRequestCreate } from "./create.ts";
import { runPullRequestList } from "./list.ts";
import { runPullRequestView } from "./view.ts";

export function registerPullRequestCommands(program: Command): void {
	const pr = program
		.command("pullrequest")
		.alias("pr")
		.description("Work with Bitbucket pull requests");

	pr.command("list")
		.description("List pull requests in a repository")
		.option(
			"-R, --repository <workspace/repo>",
			"Override repository detection",
		)
		.option(
			"-s, --state <state>",
			"Filter by state: open, merged, declined, all",
			"open",
		)
		.option("-a, --author <user>", "Filter by author (nickname, or @me)")
		.option("-r, --reviewer <user>", "Filter by reviewer (nickname, or @me)")
		.option("-L, --limit <n>", "Maximum results", "30")
		.action(withRenderer(runPullRequestList));

	pr.command("view")
		.description(
			"Show a pull request's details (defaults to the PR for the current branch)",
		)
		.argument("[id]", "Pull request number")
		.option(
			"-R, --repository <workspace/repo>",
			"Override repository detection",
		)
		.action(withRenderer(runPullRequestView));

	pr.command("create")
		.description("Open a pull request from the current branch")
		.option(
			"-R, --repository <workspace/repo>",
			"Override repository detection",
		)
		.option("-t, --title <title>", "Pull request title (required)")
		.option("-b, --body <body>", "Pull request description")
		.option(
			"-F, --body-file <path>",
			"Read description from a file ('-' for stdin support deferred)",
		)
		.option(
			"--base <branch>",
			"Destination branch (defaults to the remote's default branch)",
		)
		.action(withRenderer(runPullRequestCreate));
}
