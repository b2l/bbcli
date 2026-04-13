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
