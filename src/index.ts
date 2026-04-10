#!/usr/bin/env bun
import { Command } from "commander";
import { registerAuthCommands } from "./commands/auth/index.ts";

const program = new Command();

program
  .name("bb")
  .description("CLI for interacting with Bitbucket Cloud")
  .version("0.0.1");

registerAuthCommands(program);

await program.parseAsync();
