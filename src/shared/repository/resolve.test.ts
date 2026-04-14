import { test, expect, describe } from "bun:test";
import {
  resolveRepository,
  RepositoryResolutionError,
} from "./resolve.ts";
import type { GitRunner } from "./git.ts";

type Setup = {
  insideWorkTree?: boolean;
  remotes?: string[];
  remoteUrls?: Record<string, string>;
  currentBranch?: string;
};

function fakeGit(s: Setup = {}): GitRunner {
  return {
    async isInsideWorkTree() {
      return s.insideWorkTree ?? true;
    },
    async listRemotes() {
      return s.remotes ?? [];
    },
    async getRemoteUrl(_cwd, name) {
      return s.remoteUrls?.[name];
    },
    async getCurrentBranch() {
      return s.currentBranch;
    },
    async getSha() {
      return undefined;
    },
    async getRemoteBranchSha() {
      return undefined;
    },
    async getDefaultBranchFromRemote() {
      return undefined;
    },
  };
}

async function failureOf(promise: Promise<unknown>) {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(RepositoryResolutionError);
  return (err as RepositoryResolutionError).failure;
}

async function errorOf(promise: Promise<unknown>): Promise<RepositoryResolutionError> {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(RepositoryResolutionError);
  return err as RepositoryResolutionError;
}

describe("resolveRepository — override", () => {
  test("returns parsed override when well-formed", async () => {
    const ref = await resolveRepository(
      { override: "MyWs/MyRepo" },
      fakeGit(),
    );
    expect(ref).toEqual({ workspace: "myws", slug: "myrepo" });
  });

  test("does not consult git when override is given", async () => {
    let called = false;
    const git: GitRunner = {
      async isInsideWorkTree() {
        called = true;
        return true;
      },
      async listRemotes() {
        called = true;
        return [];
      },
      async getRemoteUrl() {
        called = true;
        return undefined;
      },
      async getCurrentBranch() {
        called = true;
        return undefined;
      },
      async getSha() {
        called = true;
        return undefined;
      },
      async getRemoteBranchSha() {
        called = true;
        return undefined;
      },
      async getDefaultBranchFromRemote() {
        called = true;
        return undefined;
      },
    };
    await resolveRepository({ override: "ws/repo" }, git);
    expect(called).toBe(false);
  });

  test("rejects malformed override", async () => {
    const cases = ["", "ws", "ws/", "/repo", "ws/repo/extra", "ws repo"];
    for (const value of cases) {
      const failure = await failureOf(
        resolveRepository({ override: value }, fakeGit()),
      );
      expect(failure).toEqual({ kind: "override-invalid", value });
    }
  });
});

describe("resolveRepository — git detection", () => {
  test("fails when cwd is not a git repo", async () => {
    const failure = await failureOf(
      resolveRepository(
        { cwd: "/tmp/not-a-repo" },
        fakeGit({ insideWorkTree: false }),
      ),
    );
    expect(failure).toEqual({
      kind: "not-a-git-repo",
      cwd: "/tmp/not-a-repo",
    });
  });

  test("fails when repo has no remotes", async () => {
    const failure = await failureOf(
      resolveRepository({ cwd: "/r" }, fakeGit({ remotes: [] })),
    );
    expect(failure).toEqual({ kind: "no-remotes" });
  });

  test("fails when origin is missing, listing available remotes", async () => {
    const failure = await failureOf(
      resolveRepository(
        { cwd: "/r" },
        fakeGit({ remotes: ["upstream", "fork"] }),
      ),
    );
    expect(failure).toEqual({
      kind: "no-origin",
      remotes: ["upstream", "fork"],
    });
  });

  test("fails with unparseable when origin URL is empty", async () => {
    const failure = await failureOf(
      resolveRepository(
        { cwd: "/r" },
        fakeGit({ remotes: ["origin"], remoteUrls: {} }),
      ),
    );
    expect(failure).toEqual({ kind: "origin-unparseable", url: "" });
  });

  test("fails with origin-not-bitbucket for non-Bitbucket hosts", async () => {
    const failure = await failureOf(
      resolveRepository(
        { cwd: "/r" },
        fakeGit({
          remotes: ["origin"],
          remoteUrls: { origin: "git@github.com:ws/repo.git" },
        }),
      ),
    );
    expect(failure).toEqual({
      kind: "origin-not-bitbucket",
      url: "git@github.com:ws/repo.git",
    });
  });

  test("fails with origin-unparseable for garbage URLs", async () => {
    const failure = await failureOf(
      resolveRepository(
        { cwd: "/r" },
        fakeGit({
          remotes: ["origin"],
          remoteUrls: { origin: "not a url at all" },
        }),
      ),
    );
    expect(failure).toEqual({
      kind: "origin-unparseable",
      url: "not a url at all",
    });
  });

  test("returns parsed ref for valid Bitbucket origin", async () => {
    const ref = await resolveRepository(
      { cwd: "/r" },
      fakeGit({
        remotes: ["origin", "upstream"],
        remoteUrls: { origin: "git@bitbucket.org:acme/widgets.git" },
      }),
    );
    expect(ref).toEqual({ workspace: "acme", slug: "widgets" });
  });
});

describe("RepositoryResolutionError messages", () => {
  test("include the override hint", async () => {
    const err = await errorOf(
      resolveRepository({ cwd: "/r" }, fakeGit({ insideWorkTree: false })),
    );
    expect(err.message).toContain("-R <workspace>/<repo>");
    expect(err.message).toContain("/r");
  });

  test("no-origin message lists remotes", async () => {
    const err = await errorOf(
      resolveRepository({ cwd: "/r" }, fakeGit({ remotes: ["upstream", "fork"] })),
    );
    expect(err.message).toContain("upstream, fork");
  });
});
