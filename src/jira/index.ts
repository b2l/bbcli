#!/usr/bin/env bun
import { Command } from "commander";

const program = new Command();

program
  .name("atla-jira")
  .description("CLI for interacting with Jira")
  .version("0.0.1");

program.parse();
