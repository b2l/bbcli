import {
  BitbucketAuthError,
  verifyCredentials,
} from "../../backend/auth/index.ts";
import {
  ConfigError,
  defaultConfigPath,
  loadConfig,
  type Config,
} from "../../shared/config/index.ts";

const TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

export async function runAuthStatus(): Promise<void> {
  let config: Config;
  try {
    config = await loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      printSetupInstructions(err.message);
      process.exit(1);
    }
    throw err;
  }

  try {
    const account = await verifyCredentials(config);
    const displayName = account.display_name ?? config.email;
    console.log(
      `Logged in to Bitbucket Cloud as ${displayName} (${config.email}).`,
    );
  } catch (err) {
    if (err instanceof BitbucketAuthError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

function printSetupInstructions(reason: string): void {
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
  console.error(lines.join("\n"));
}
