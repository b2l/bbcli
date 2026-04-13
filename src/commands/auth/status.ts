import {
  BitbucketAuthError,
  verifyCredentials,
} from "../../backend/auth/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";

export async function runAuthStatus(): Promise<void> {
  const config = await loadConfigOrExit();

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
