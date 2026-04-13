import {
  listWorkspaces,
  WorkspaceError,
} from "../../backend/workspaces/index.ts";
import { loadConfigOrExit } from "../../shared/config/index.ts";

export async function runWorkspaceList(): Promise<void> {
  const config = await loadConfigOrExit();

  try {
    const workspaces = await listWorkspaces(config);

    if (workspaces.length === 0) {
      console.log("No workspaces found.");
      return;
    }

    const slugWidth = Math.max(...workspaces.map((w) => w.slug.length));

    for (const ws of workspaces) {
      const slug = ws.slug.padEnd(slugWidth);
      const role = ws.administrator ? "admin" : "member";
      console.log(`${slug}  ${role}`);
    }
  } catch (err) {
    if (err instanceof WorkspaceError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
