#!/usr/bin/env bun
import { Command } from "commander";

const program = new Command();

program
  .name("bb")
  .description("CLI for interacting with Bitbucket Cloud")
  .version("0.0.1");

program.parse();
