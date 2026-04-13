#!/usr/bin/env bun
import { Command } from "commander";
import { registerAuthCommands } from "./commands/auth/index.ts";
import { registerWorkspaceCommands } from "./commands/workspace/index.ts";

const program = new Command();

program
  .name("bb")
  .description("CLI for interacting with Bitbucket Cloud")
  .version("0.0.1")
  .option("--json", "Output machine-readable JSON");

registerAuthCommands(program);
registerWorkspaceCommands(program);

await program.parseAsync();
