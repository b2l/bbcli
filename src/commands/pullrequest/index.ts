import type { Command } from "commander";
import { withRenderer } from "../../shared/renderer/commander.ts";
import { runPullRequestComment } from "./comment.ts";
import { runPullRequestCreate } from "./create.ts";
import { runPullRequestList } from "./list.ts";
import {
	runPullRequestApprove,
	runPullRequestRequestChanges,
	runPullRequestUnapprove,
	runPullRequestUnrequestChanges,
} from "./review.ts";
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
		.option("--draft", "Create as a draft pull request")
		.action(withRenderer(runPullRequestCreate));

	pr.command("comment")
		.description(
			"Post a top-level comment on a pull request (defaults to the PR for the current branch)",
		)
		.argument("[id]", "Pull request number")
		.option(
			"-R, --repository <workspace/repo>",
			"Override repository detection",
		)
		.option("-b, --body <body>", "Comment body (markdown)")
		.option(
			"-F, --body-file <path>",
			"Read comment body from a file ('-' for stdin)",
		)
		.action(withRenderer(runPullRequestComment));

	pr.command("approve")
		.description(
			"Approve a pull request (defaults to the PR for the current branch)",
		)
		.argument("[id]", "Pull request number")
		.option(
			"-R, --repository <workspace/repo>",
			"Override repository detection",
		)
		.action(withRenderer(runPullRequestApprove));

	pr.command("unapprove")
		.description(
			"Withdraw your approval on a pull request (defaults to the PR for the current branch)",
		)
		.argument("[id]", "Pull request number")
		.option(
			"-R, --repository <workspace/repo>",
			"Override repository detection",
		)
		.action(withRenderer(runPullRequestUnapprove));

	pr.command("request-changes")
		.description(
			"Mark a pull request as needing changes (defaults to the PR for the current branch)",
		)
		.argument("[id]", "Pull request number")
		.option(
			"-R, --repository <workspace/repo>",
			"Override repository detection",
		)
		.action(withRenderer(runPullRequestRequestChanges));

	pr.command("unrequest-changes")
		.description(
			"Withdraw your request-for-changes on a pull request (defaults to the PR for the current branch)",
		)
		.argument("[id]", "Pull request number")
		.option(
			"-R, --repository <workspace/repo>",
			"Override repository detection",
		)
		.action(withRenderer(runPullRequestUnrequestChanges));
}
