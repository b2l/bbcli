import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";
import type { Renderer } from "../renderer/index.ts";

export type Config = { email: string; token: string };

export class ConfigError extends Error {
	override name = "ConfigError";
}

export function defaultConfigPath(): string {
	const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
	return join(base, "bbcli", "config.json");
}

const configSchema = z
	.object({
		email: z.string().min(1),
		token: z.string().min(1).optional(),
		token_command: z.array(z.string()).min(1).optional(),
	})
	.refine(
		(c) => Boolean(c.token) !== Boolean(c.token_command),
		'Exactly one of "token" or "token_command" must be set.',
	);

export async function loadConfig(path = defaultConfigPath()): Promise<Config> {
	const file = Bun.file(path);
	if (!(await file.exists()))
		throw new ConfigError(`No config file found at ${path}.`);

	let raw: unknown;
	try {
		raw = await file.json();
	} catch {
		throw new ConfigError(`${path} is not valid JSON.`);
	}

	const result = configSchema.safeParse(raw);
	if (!result.success)
		throw new ConfigError(
			`Invalid config in ${path}: ${z.prettifyError(result.error)}`,
		);

	const { email, token, token_command } = result.data;
	const resolvedToken = token ?? (await runTokenCommand(token_command!));

	return { email, token: resolvedToken };
}

const TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

export async function loadConfigOrExit(renderer: Renderer): Promise<Config> {
	try {
		return await loadConfig();
	} catch (err) {
		if (err instanceof ConfigError) {
			renderer.error(buildSetupInstructions(err.message));
			process.exit(1);
		}
		throw err;
	}
}

function buildSetupInstructions(reason: string): string {
	const lines = [
		reason,
		"",
		"To configure bbcli:",
		"",
		`  1. Create an API token at ${TOKEN_URL}`,
		"",
		`  2. Create ${defaultConfigPath()} with your Atlassian email and a way`,
		"     to retrieve the token. The recommended shape fetches the token",
		"     from your system keyring via a command:",
		"",
		"         {",
		'           "email": "you@example.com",',
		'           "token_command": [',
		'             "secret-tool", "lookup",',
		'             "service", "bbcli",',
		'             "account", "bitbucket_api_token"',
		"           ]",
		"         }",
		"",
		"     Then store the token in your keyring:",
		"",
		"         secret-tool store --label='bbcli' \\",
		"             service bbcli account bitbucket_api_token",
		"",
		'     Alternatively, put the token directly in the config as a "token"',
		"     field. If you do, chmod 600 the config file.",
		"",
		"  3. Re-run `bb auth status` to verify.",
	];
	return lines.join("\n");
}

async function runTokenCommand(argv: string[]): Promise<string> {
	let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		proc = Bun.spawn({ cmd: argv, stdout: "pipe", stderr: "pipe" });
	} catch (err) {
		throw new ConfigError(
			`Failed to run token_command: ${(err as Error).message}`,
		);
	}

	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	if (code !== 0)
		throw new ConfigError(
			`token_command exited with code ${code}: ${(stderr || stdout).trim() || "(no output)"}`,
		);

	const result = stdout.trimEnd();
	if (!result) throw new ConfigError("token_command produced no output.");
	return result;
}
