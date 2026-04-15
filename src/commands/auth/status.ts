import {
	type BitbucketAccount,
	BitbucketAuthError,
	verifyCredentials,
} from "../../backend/auth/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";

export async function runAuthStatus(renderer: Renderer): Promise<void> {
	const config = await loadConfigOrExit(renderer);

	try {
		const account = await verifyCredentials(config);
		renderer.detail<BitbucketAccount & { email: string }>(
			{ ...account, email: config.email },
			[
				{ label: "Account", value: (a) => a.display_name ?? "(no name)" },
				{ label: "Email", value: (a) => a.email },
			],
		);
	} catch (err) {
		if (err instanceof BitbucketAuthError) {
			renderer.error(err.message);
			process.exit(1);
		}
		throw err;
	}
}
