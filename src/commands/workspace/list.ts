import {
  listWorkspaces,
  WorkspaceError,
} from "../../backend/workspaces/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";
import type { Renderer } from "../../shared/renderer/index.ts";

export async function runWorkspaceList(renderer: Renderer): Promise<void> {
  const config = await loadConfigOrExit(renderer);

  try {
    const workspaces = await listWorkspaces(config);

    if (workspaces.length === 0) {
      renderer.message("No workspaces found.");
      return;
    }

    renderer.list(workspaces, [
      { header: "SLUG", value: (w) => w.slug },
      {
        header: "ROLE",
        value: (w) => (w.administrator ? "admin" : "member"),
        style: "muted",
      },
    ]);
  } catch (err) {
    if (err instanceof WorkspaceError) {
      renderer.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
