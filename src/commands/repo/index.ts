import type { Command } from "commander";
import { withRenderer } from "../../shared/renderer/commander.ts";
import { runRepoClone } from "./clone.ts";
import { runRepoCurrent } from "./current.ts";
import { runRepoList } from "./list.ts";

export function registerRepoCommands(program: Command): void {
	const repo = program
		.command("repo")
		.description("Work with Bitbucket repositories");

	repo
		.command("current")
		.description("Print the repository bbcli would act on")
		.option(
			"-R, --repository <workspace/repo>",
			"Override repository detection",
		)
		.action(withRenderer(runRepoCurrent));

	repo
		.command("list")
		.description("List repositories in a workspace")
		.option(
			"-R, --repository <workspace>",
			"Workspace to list (default: current repo's workspace)",
		)
		.option("-l, --limit <n>", "Maximum number of results", "30")
		.option("-q, --query <name>", "Filter by name (substring match)")
		.action(withRenderer(runRepoList));

	repo
		.command("clone <repo>")
		.description("Clone a Bitbucket repository")
		.option(
			"-R, --repository <workspace>",
			"Workspace (default: current repo's workspace)",
		)
		.option("--https", "Use HTTPS instead of SSH")
		.action(withRenderer(runRepoClone));
}
