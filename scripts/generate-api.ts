#!/usr/bin/env bun
/**
 * Regenerate TypeScript types from Atlassian's Bitbucket Cloud OpenAPI spec.
 *
 * Downloads the spec from the canonical Atlassian URL, runs openapi-typescript
 * over it, and writes the result to src/shared/bitbucket-http/generated.d.ts.
 *
 * The generated file is committed to the repo so builds are reproducible and
 * so spec drift is visible in diffs. Re-run this script when you need new
 * endpoints or when Atlassian updates the spec.
 *
 * Usage: bun run generate:api
 */
import openapiTS, { astToString } from "openapi-typescript";

const SPEC_URL = "https://dac-static.atlassian.com/cloud/bitbucket/swagger.v3.json";
const OUTPUT_PATH = new URL("../src/shared/bitbucket-http/generated.d.ts", import.meta.url);

const HEADER = `/**
 * AUTO-GENERATED — do not edit by hand.
 * Source: ${SPEC_URL}
 * Regenerate with: bun run generate:api
 */
`;

console.log(`Fetching OpenAPI spec from ${SPEC_URL}...`);
const ast = await openapiTS(new URL(SPEC_URL));
const contents = HEADER + astToString(ast);

await Bun.write(OUTPUT_PATH, contents);
console.log(`Wrote ${contents.length.toLocaleString()} bytes to ${OUTPUT_PATH.pathname}`);
