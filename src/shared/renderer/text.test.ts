import { test, expect, describe } from "bun:test";
import { createTextRenderer } from "./text.ts";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const renderer = createTextRenderer({
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  });
  return { renderer, out: () => out.join(""), err: () => err.join("") };
}

// Strip ANSI escapes so assertions aren't hostage to the color palette.
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("TextRenderer", () => {
  test("message writes a line to stdout", () => {
    const c = capture();
    c.renderer.message("hello");
    expect(c.out()).toBe("hello\n");
    expect(c.err()).toBe("");
  });

  test("error writes to stderr with a red prefix", () => {
    const c = capture();
    c.renderer.error("something broke");
    expect(strip(c.err())).toBe("error: something broke\n");
    expect(c.out()).toBe("");
  });

  test("list prints aligned columns with header", () => {
    const c = capture();
    c.renderer.list(
      [
        { slug: "short", admin: true },
        { slug: "much-longer-slug", admin: false },
      ],
      [
        { header: "SLUG", value: (w) => w.slug },
        { header: "ROLE", value: (w) => (w.admin ? "admin" : "member") },
      ],
    );
    expect(strip(c.out())).toMatchInlineSnapshot(`
      "SLUG              ROLE
      short             admin
      much-longer-slug  member
      "
    `);
  });

  test("list with no items writes nothing", () => {
    const c = capture();
    c.renderer.list([], [{ header: "X", value: () => "" }]);
    expect(c.out()).toBe("");
  });

  test("detail prints label-value pairs aligned", () => {
    const c = capture();
    c.renderer.detail(
      { name: "Alice", email: "alice@example.com" },
      [
        { label: "Account", value: (a) => a.name },
        { label: "Email", value: (a) => a.email },
      ],
    );
    expect(strip(c.out())).toMatchInlineSnapshot(`
      "Account: Alice
      Email  : alice@example.com
      "
    `);
  });

  test("applies per-column style without corrupting text", () => {
    // picocolors auto-disables colors when stdout isn't a TTY (as in tests),
    // so we can't assert on ANSI codes here. Instead, verify the styled
    // output still contains the correct underlying text — guards against
    // accidentally dropping cells, double-wrapping, etc.
    const c = capture();
    c.renderer.list(
      [{ slug: "team-a", admin: true }],
      [
        { header: "SLUG", value: (w) => w.slug },
        {
          header: "ROLE",
          value: (w) => (w.admin ? "admin" : "member"),
          style: "muted",
        },
      ],
    );
    expect(strip(c.out())).toContain("team-a");
    expect(strip(c.out())).toContain("admin");
  });
});
