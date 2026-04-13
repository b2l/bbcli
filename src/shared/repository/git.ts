import { $ } from "bun";

/**
 * Thin wrapper around the git CLI. Injected into resolveRepository so tests
 * can simulate every failure mode without shelling out. Production code uses
 * the default implementation backed by `git -C <cwd>`.
 */
export interface GitRunner {
  isInsideWorkTree(cwd: string): Promise<boolean>;
  /** Returns remote names in the order git reports them. */
  listRemotes(cwd: string): Promise<string[]>;
  /** Returns the URL of a remote, or undefined if the remote does not exist. */
  getRemoteUrl(cwd: string, name: string): Promise<string | undefined>;
}

export const defaultGitRunner: GitRunner = {
  async isInsideWorkTree(cwd) {
    const result = await $`git -C ${cwd} rev-parse --is-inside-work-tree`
      .nothrow()
      .quiet();
    if (result.exitCode !== 0) return false;
    return result.stdout.toString().trim() === "true";
  },

  async listRemotes(cwd) {
    const result = await $`git -C ${cwd} remote`.nothrow().quiet();
    if (result.exitCode !== 0) return [];
    return result.stdout
      .toString()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  },

  async getRemoteUrl(cwd, name) {
    const result = await $`git -C ${cwd} remote get-url ${name}`
      .nothrow()
      .quiet();
    if (result.exitCode !== 0) return undefined;
    const url = result.stdout.toString().trim();
    return url || undefined;
  },
};
