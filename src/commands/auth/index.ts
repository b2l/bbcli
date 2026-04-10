import type { Command } from "commander";
import { runAuthStatus } from "./status.ts";

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command("auth")
    .description("Authenticate bbcli against Bitbucket Cloud");

  auth
    .command("status")
    .description("Verify that the configured Bitbucket credentials work")
    .action(runAuthStatus);
}
