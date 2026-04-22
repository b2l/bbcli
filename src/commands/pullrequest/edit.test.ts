import { describe, expect, test } from "bun:test";
import { parseMessage } from "./edit.ts";

describe("parseMessage", () => {
	test("first line becomes the title; rest after blank line becomes the description", () => {
		expect(parseMessage("Hello world\n\nA description here.\n")).toEqual({
			title: "Hello world",
			description: "A description here.",
		});
	});

	test("handles multi-paragraph descriptions verbatim", () => {
		expect(parseMessage("Title\n\nPara one.\n\nPara two.\n\n* list\n")).toEqual(
			{
				title: "Title",
				description: "Para one.\n\nPara two.\n\n* list",
			},
		);
	});

	test("no description yields an empty string", () => {
		expect(parseMessage("Just a title\n")).toEqual({
			title: "Just a title",
			description: "",
		});
	});

	test("leading empty lines are skipped", () => {
		expect(parseMessage("\n\nTitle\n\nBody\n")).toEqual({
			title: "Title",
			description: "Body",
		});
	});

	test("trailing blank lines on the title are tolerated (multiple separators)", () => {
		expect(parseMessage("Title\n\n\n\nBody\n")).toEqual({
			title: "Title",
			description: "Body",
		});
	});

	test("CRLF line endings are handled", () => {
		expect(parseMessage("Title\r\n\r\nBody\r\n")).toEqual({
			title: "Title",
			description: "Body",
		});
	});

	test("empty input returns null (caller treats as abort)", () => {
		expect(parseMessage("")).toBeNull();
		expect(parseMessage("\n\n\n")).toBeNull();
		expect(parseMessage("   \n\t\n")).toBeNull();
	});

	test("title is trimmed", () => {
		expect(parseMessage("  Spacey title  \n\nbody\n")).toEqual({
			title: "Spacey title",
			description: "body",
		});
	});
});
