import { describe, expect, test } from "bun:test";
import { parseBitbucketRemoteUrl } from "./parse-url.ts";

describe("parseBitbucketRemoteUrl", () => {
	const accepted: [string, string, string][] = [
		["git@bitbucket.org:ws/repo.git", "ws", "repo"],
		["git@bitbucket.org:ws/repo", "ws", "repo"],
		["https://bitbucket.org/ws/repo.git", "ws", "repo"],
		["https://bitbucket.org/ws/repo", "ws", "repo"],
		["https://bitbucket.org/ws/repo/", "ws", "repo"],
		["https://user@bitbucket.org/ws/repo.git", "ws", "repo"],
		["ssh://git@bitbucket.org/ws/repo.git", "ws", "repo"],
		// case insensitivity on host + slug normalization
		["https://BITBUCKET.ORG/WS/Repo.git", "ws", "repo"],
		// trailing whitespace
		["  git@bitbucket.org:ws/repo.git  ", "ws", "repo"],
	];

	for (const [url, workspace, slug] of accepted) {
		test(`accepts ${url}`, () => {
			expect(parseBitbucketRemoteUrl(url)).toEqual({ workspace, slug });
		});
	}

	const rejected = [
		"",
		"not a url",
		"git@github.com:ws/repo.git",
		"https://github.com/ws/repo.git",
		"https://bitbucket.org/",
		"https://bitbucket.org/ws",
		"https://bitbucket.org/ws/repo/extra",
		"https://api.bitbucket.org/ws/repo",
		"https://foo.bitbucket.org/ws/repo",
		"ftp://bitbucket.org/ws/repo",
		"git@bitbucket.org:ws",
		"git@bitbucket.org:/repo.git",
	];

	for (const url of rejected) {
		test(`rejects ${JSON.stringify(url)}`, () => {
			expect(parseBitbucketRemoteUrl(url)).toBeNull();
		});
	}
});
