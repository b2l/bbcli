import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultGitRunner } from "./git.ts";
import {
  resolveRepository,
  RepositoryResolutionError,
} from "./resolve.ts";

/**
 * Integration tests: exercise the real `Bun.$`-backed git runner against a
 * throwaway git repo. Catches bugs in how we invoke git (exit codes, output
 * parsing) that the unit tests mock away.
 */

let repoDir: string;
let nestedDir: string;
let nonRepoDir: string;

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "bbcli-repo-test-"));
  repoDir = join(root, "repo");
  nestedDir = join(repoDir, "src", "deep", "nested");
  nonRepoDir = join(root, "plain");
  await $`mkdir -p ${repoDir} ${nestedDir} ${nonRepoDir}`.quiet();
  await $`git -C ${repoDir} init -q -b main`.quiet();
  await $`git -C ${repoDir} remote add origin git@bitbucket.org:acme/widgets.git`.quiet();
  await $`git -C ${repoDir} remote add upstream https://bitbucket.org/other/widgets.git`.quiet();
});

afterAll(async () => {
  if (repoDir) {
    const parent = join(repoDir, "..");
    await rm(parent, { recursive: true, force: true });
  }
});

describe("defaultGitRunner", () => {
  test("detects work tree", async () => {
    expect(await defaultGitRunner.isInsideWorkTree(repoDir)).toBe(true);
    expect(await defaultGitRunner.isInsideWorkTree(nonRepoDir)).toBe(false);
  });

  test("lists remotes in config order", async () => {
    const remotes = await defaultGitRunner.listRemotes(repoDir);
    expect(remotes).toContain("origin");
    expect(remotes).toContain("upstream");
  });

  test("returns remote URLs", async () => {
    expect(await defaultGitRunner.getRemoteUrl(repoDir, "origin")).toBe(
      "git@bitbucket.org:acme/widgets.git",
    );
    expect(await defaultGitRunner.getRemoteUrl(repoDir, "nope")).toBeUndefined();
  });

  test("returns current branch name", async () => {
    // The repo was init'd with `-b main`; HEAD points at `main` even with no
    // commits yet (symbolic-ref reads HEAD without requiring the branch to
    // exist as a ref).
    expect(await defaultGitRunner.getCurrentBranch(repoDir)).toBe("main");
  });

  test("returns undefined on detached HEAD", async () => {
    // Create a commit and a second branch, then detach HEAD by checking out
    // the commit hash. symbolic-ref exits non-zero in that state.
    await $`git -C ${repoDir} commit --allow-empty -m init`.quiet();
    const sha = (
      await $`git -C ${repoDir} rev-parse HEAD`.quiet()
    ).stdout.toString().trim();
    await $`git -C ${repoDir} checkout --detach ${sha}`.quiet();
    try {
      expect(await defaultGitRunner.getCurrentBranch(repoDir)).toBeUndefined();
    } finally {
      await $`git -C ${repoDir} checkout main`.quiet();
    }
  });

  test("returns undefined outside a git repo", async () => {
    expect(await defaultGitRunner.getCurrentBranch(nonRepoDir)).toBeUndefined();
  });
});

describe("resolveRepository with real git", () => {
  test("resolves origin from a real repo", async () => {
    const ref = await resolveRepository({ cwd: repoDir });
    expect(ref).toEqual({ workspace: "acme", slug: "widgets" });
  });

  test("resolves origin when invoked from a subdirectory", async () => {
    const ref = await resolveRepository({ cwd: nestedDir });
    expect(ref).toEqual({ workspace: "acme", slug: "widgets" });
  });

  test("fails outside a git repo", async () => {
    const err = await resolveRepository({ cwd: nonRepoDir }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepositoryResolutionError);
    expect((err as RepositoryResolutionError).failure.kind).toBe("not-a-git-repo");
  });
});
