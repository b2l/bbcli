import type { Command } from "commander";
import { runWorkspaceList } from "./list.ts";

export function registerWorkspaceCommands(program: Command): void {
  const workspace = program
    .command("workspace")
    .description("Manage Bitbucket workspaces");

  workspace
    .command("list")
    .description("List workspaces you have access to")
    .action(runWorkspaceList);
}
