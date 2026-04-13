import type { Command } from "commander";
import { withRenderer } from "../../shared/renderer/commander.ts";
import { runRepoCurrent } from "./current.ts";

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
}
