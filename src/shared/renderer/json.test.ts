import { test, expect, describe } from "bun:test";
import { createJsonRenderer } from "./json.ts";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const renderer = createJsonRenderer({
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  });
  return { renderer, out: () => out.join(""), err: () => err.join("") };
}

describe("JsonRenderer", () => {
  test("message is a no-op (avoids noise in JSON pipelines)", () => {
    const c = capture();
    c.renderer.message("hello");
    expect(c.out()).toBe("");
    expect(c.err()).toBe("");
  });

  test("error writes plain text to stderr (no JSON envelope)", () => {
    const c = capture();
    c.renderer.error("something broke");
    expect(c.err()).toBe("something broke\n");
    expect(c.out()).toBe("");
  });

  test("list emits raw array to stdout, ignoring column definitions", () => {
    const c = capture();
    const items = [
      { slug: "a", admin: true },
      { slug: "b", admin: false },
    ];
    c.renderer.list(items, [
      { header: "SLUG", value: (w) => w.slug },
      // value functions are intentionally not invoked for JSON mode.
      { header: "ROLE", value: (w) => (w.admin ? "admin" : "member") },
    ]);
    expect(JSON.parse(c.out())).toEqual(items);
  });

  test("detail emits raw object to stdout", () => {
    const c = capture();
    const item = { name: "Alice", email: "alice@example.com" };
    c.renderer.detail(item, [
      { label: "Account", value: (a) => a.name },
    ]);
    expect(JSON.parse(c.out())).toEqual(item);
  });

  test("empty list emits an empty JSON array", () => {
    const c = capture();
    c.renderer.list([], [{ header: "X", value: () => "" }]);
    expect(JSON.parse(c.out())).toEqual([]);
  });
});
