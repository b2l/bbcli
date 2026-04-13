import { createJsonRenderer } from "./json.ts";
import { createTextRenderer } from "./text.ts";
import type { Renderer } from "./types.ts";

export type { Column, Field, Renderer, Style } from "./types.ts";

export function createRenderer({ json }: { json: boolean }): Renderer {
  return json ? createJsonRenderer() : createTextRenderer();
}
