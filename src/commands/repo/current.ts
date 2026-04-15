import type { Renderer } from "../../shared/renderer/index.ts";
import {
	RepositoryResolutionError,
	resolveRepository,
} from "../../shared/repository/index.ts";

export type CurrentOptions = { repository?: string };

export async function runRepoCurrent(
	renderer: Renderer,
	options: CurrentOptions,
): Promise<void> {
	try {
		const ref = await resolveRepository({ override: options.repository });
		renderer.detail(ref, [
			{ label: "WORKSPACE", value: (r) => r.workspace },
			{ label: "REPO", value: (r) => r.slug },
		]);
	} catch (err) {
		if (err instanceof RepositoryResolutionError) {
			renderer.error(err.message);
			process.exit(1);
		}
		throw err;
	}
}
