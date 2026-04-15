/**
 * Local augmentations to Bitbucket's OpenAPI spec.
 *
 * Bitbucket's published spec is famously thin — common query params like
 * `q`, `sort`, `pagelen`, and `page` are documented in prose but missing
 * from per-endpoint schemas. Without this overlay every paginated/filterable
 * backend would have to cast `query as any` and lose all type safety on
 * those fields.
 *
 * Add an entry per endpoint we use that needs extra coverage. Keep this
 * file small and obvious; it's a maintenance burden we're choosing to take.
 */

type ParameterSchema = {
	type?: string;
	enum?: readonly string[];
	items?: ParameterSchema;
	minimum?: number;
	maximum?: number;
};

export type OverlayParameter = {
	name: string;
	in: "query";
	description?: string;
	required?: boolean;
	explode?: boolean;
	schema: ParameterSchema;
};

export type OperationOverlay = {
	/** Append params (skipped if already present by name). */
	addParameters?: OverlayParameter[];
	/** Replace existing params by name (or add if missing). */
	replaceParameters?: OverlayParameter[];
};

export type Overlay = {
	[path: string]: {
		[method: string]: OperationOverlay;
	};
};

const PAGINATION: OverlayParameter[] = [
	{
		name: "page",
		in: "query",
		description: "Page number (1-based) for paginated results.",
		schema: { type: "integer", minimum: 1 },
	},
	{
		name: "pagelen",
		in: "query",
		description:
			"Number of items per page. Default 10; maximum varies per endpoint (typically 50 or 100).",
		schema: { type: "integer", minimum: 1, maximum: 100 },
	},
];

const FILTER_AND_SORT: OverlayParameter[] = [
	{
		name: "q",
		in: "query",
		description:
			"BBQL filter expression. See https://developer.atlassian.com/cloud/bitbucket/rest/intro/#filtering",
		schema: { type: "string" },
	},
	{
		name: "sort",
		in: "query",
		description:
			"Field to sort by. Prefix with '-' for descending. See https://developer.atlassian.com/cloud/bitbucket/rest/intro/#sorting",
		schema: { type: "string" },
	},
];

const PR_STATES = ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"] as const;

export const overlay: Overlay = {
	"/user/workspaces": {
		get: {
			addParameters: [...PAGINATION, ...FILTER_AND_SORT],
		},
	},
	"/repositories/{workspace}/{repo_slug}/pullrequests": {
		get: {
			addParameters: [...PAGINATION, ...FILTER_AND_SORT],
			replaceParameters: [
				{
					name: "state",
					in: "query",
					description:
						"Only return pull requests in these states. Repeat the param to combine.",
					explode: true,
					schema: {
						type: "array",
						items: { type: "string", enum: PR_STATES },
					},
				},
			],
		},
	},
};
