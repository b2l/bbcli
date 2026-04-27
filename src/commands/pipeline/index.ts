import type { Command } from "commander";
import { withRenderer } from "../../shared/renderer/commander.ts";
import { runPipelineList } from "./list.ts";

export function registerPipelineCommands(program: Command): void {
	const pipeline = program
		.command("pipeline")
		.alias("pipe")
		.description("Work with Bitbucket Pipelines");

	pipeline
		.command("list")
		.description("List recent pipeline runs for the current repo")
		.option(
			"-R, --repository <workspace/repo>",
			"Override repository detection",
		)
		.option("-b, --branch <branch>", "Filter by branch")
		.option(
			"-s, --status <status>",
			"Filter by status: pending, running, success, failed, stopped, error",
		)
		.option("-L, --limit <n>", "Maximum results", "30")
		.action(withRenderer(runPipelineList));
}
