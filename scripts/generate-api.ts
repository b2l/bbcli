#!/usr/bin/env bun
/**
 * Regenerate TypeScript types from Atlassian's Bitbucket Cloud OpenAPI spec.
 *
 * Downloads the spec from the canonical Atlassian URL, applies our local
 * overlay (see ./openapi-overlay.ts), runs openapi-typescript over the
 * result, and writes the output to src/shared/bitbucket-http/generated.d.ts.
 *
 * The generated file is committed to the repo so builds are reproducible and
 * so spec drift is visible in diffs. Re-run this script when you need new
 * endpoints, when the overlay changes, or when Atlassian updates the spec.
 *
 * Usage: bun run generate:api
 */
import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";
import {
	type OperationOverlay,
	type OverlayParameter,
	overlay,
} from "./openapi-overlay.ts";

const SPEC_URL =
	"https://dac-static.atlassian.com/cloud/bitbucket/swagger.v3.json";
const OUTPUT_PATH = new URL(
	"../src/shared/bitbucket-http/generated.d.ts",
	import.meta.url,
);

const HEADER = `/**
 * AUTO-GENERATED — do not edit by hand.
 * Source: ${SPEC_URL}
 * Local overlay: scripts/openapi-overlay.ts
 * Regenerate with: bun run generate:api
 */
`;

console.log(`Fetching OpenAPI spec from ${SPEC_URL}...`);
const response = await fetch(SPEC_URL);
if (!response.ok) {
	throw new Error(`Failed to fetch spec: HTTP ${response.status}`);
}
const spec = (await response.json()) as Record<string, any>;

console.log("Applying local overlay...");
applyOverlay(spec, overlay);

console.log("Generating TypeScript...");
const ast = await openapiTS(spec as OpenAPI3);
const contents = HEADER + astToString(ast);

await Bun.write(OUTPUT_PATH, contents);
console.log(
	`Wrote ${contents.length.toLocaleString()} bytes to ${OUTPUT_PATH.pathname}`,
);

function applyOverlay(
	spec: Record<string, any>,
	overlay: Record<string, Record<string, OperationOverlay>>,
): void {
	const paths = spec.paths as Record<string, any> | undefined;
	if (!paths)
		throw new Error("Spec has no `paths` object — refusing to apply overlay.");

	for (const [path, methods] of Object.entries(overlay)) {
		const pathItem = paths[path];
		if (!pathItem) {
			// Loud warning: an overlay entry that doesn't match the spec is
			// either a typo or a sign Bitbucket renamed something. Either way
			// the maintainer needs to know.
			console.warn(`  ! overlay path not found in spec: ${path}`);
			continue;
		}
		for (const [method, mods] of Object.entries(methods)) {
			const op = pathItem[method];
			if (!op) {
				console.warn(
					`  ! overlay method not found: ${method.toUpperCase()} ${path}`,
				);
				continue;
			}
			op.parameters ??= [];
			const params = op.parameters as OverlayParameter[];

			if (mods.replaceParameters) {
				for (const replacement of mods.replaceParameters) {
					const idx = params.findIndex(
						(p) => p.name === replacement.name && p.in === replacement.in,
					);
					if (idx >= 0) params[idx] = replacement;
					else params.push(replacement);
				}
			}
			if (mods.addParameters) {
				for (const addition of mods.addParameters) {
					const exists = params.some(
						(p) => p.name === addition.name && p.in === addition.in,
					);
					if (!exists) params.push(addition);
				}
			}
			console.log(`  ✓ overlaid ${method.toUpperCase()} ${path}`);
		}
	}
}
