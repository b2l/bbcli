// Intentionally narrow: ESLint is here only to enforce the
// commands → backend → shared dependency rule via
// eslint-plugin-boundaries. Formatting and general lint are Biome's job.
//
// See BBC2-34 for the rationale.

import tsParser from "@typescript-eslint/parser";
import boundaries from "eslint-plugin-boundaries";

export default [
	{
		files: ["src/**/*.ts"],
		ignores: ["src/shared/bitbucket-http/generated.d.ts", "src/**/*.test.ts"],
		languageOptions: {
			parser: tsParser,
			ecmaVersion: "latest",
			sourceType: "module",
		},
		plugins: { boundaries },
		settings: {
			"boundaries/elements": [
				{ type: "commands", pattern: "src/commands/*", mode: "folder" },
				{ type: "backend", pattern: "src/backend/*", mode: "folder" },
				{ type: "shared", pattern: "src/shared/*", mode: "folder" },
			],
		},
		rules: {
			"boundaries/dependencies": [
				"error",
				{
					default: "disallow",
					rules: [
						{ from: "commands", allow: ["commands", "backend", "shared"] },
						{
							from: "backend",
							allow: [
								["backend", { elementName: "{{from.elementName}}" }],
								"shared",
							],
						},
						{ from: "shared", allow: ["shared"] },
					],
				},
			],
		},
	},
];
