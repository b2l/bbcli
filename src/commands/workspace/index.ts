import type { Command } from "commander";
import { withRenderer } from "../../shared/renderer/commander.ts";
import { runWorkspaceList } from "./list.ts";

export function registerWorkspaceCommands(program: Command): void {
  const workspace = program
    .command("workspace")
    .description("Manage Bitbucket workspaces");

  workspace
    .command("list")
    .description("List workspaces you have access to")
    .action(withRenderer(runWorkspaceList));
}
