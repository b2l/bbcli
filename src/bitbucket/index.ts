#!/usr/bin/env bun
import { Command } from "commander";

const program = new Command();

program
  .name("atla-bb")
  .description("CLI for interacting with Bitbucket")
  .version("0.0.1");

program.parse();
