import { describe, expect, test } from "bun:test";
import { formatRelativeTime } from "./index.ts";

const NOW = new Date("2026-04-13T12:00:00Z");

describe("formatRelativeTime", () => {
	test("returns 'just now' for sub-minute diffs", () => {
		expect(formatRelativeTime("2026-04-13T11:59:30Z", NOW)).toBe("just now");
	});

	test("future timestamps collapse to 'just now'", () => {
		expect(formatRelativeTime("2026-04-13T12:00:30Z", NOW)).toBe("just now");
	});

	test("formats minutes", () => {
		expect(formatRelativeTime("2026-04-13T11:55:00Z", NOW)).toBe("5m ago");
	});

	test("formats hours", () => {
		expect(formatRelativeTime("2026-04-13T10:00:00Z", NOW)).toBe("2h ago");
	});

	test("formats days", () => {
		expect(formatRelativeTime("2026-04-10T12:00:00Z", NOW)).toBe("3d ago");
	});

	test("formats months", () => {
		expect(formatRelativeTime("2026-02-01T12:00:00Z", NOW)).toBe("2mo ago");
	});

	test("formats years", () => {
		expect(formatRelativeTime("2024-01-01T12:00:00Z", NOW)).toBe("2y ago");
	});

	test("returns empty string for invalid input", () => {
		expect(formatRelativeTime("not-a-date", NOW)).toBe("");
	});
});
