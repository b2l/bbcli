# Bitbucket Cloud API — verified notes

Findings pulled directly from the generated OpenAPI typings at `src/shared/bitbucket-http/generated.d.ts`. Every claim below cites the line it came from so it can be re-verified if the spec is regenerated. If the line numbers drift, re-grep for the anchor strings.

## Default reviewers on `POST /pullrequests`

**There is no API parameter to "apply default reviewers server-side".** The `POST /repositories/{workspace}/{repo_slug}/pullrequests` endpoint takes a `pullrequest` body whose `reviewers` field is an explicit array of user objects — Bitbucket does not read the repo-level or project-level default-reviewers configuration when handling a create request (generated.d.ts:9965–10180).

Reviewer object shape in the POST body:

```json
{ "reviewers": [{ "uuid": "{504c3b62-8120-4f0c-a7bc-87800b9d6f70}" }] }
```

Per the doc comment at generated.d.ts:10098–10114, `uuid` is the format shown. `account_id` likely also works but is not in the example — verify with a real call if it matters.

Observed consequence (also see the screenshot in BBC2-40): repo **Default reviewers** configured in the Bitbucket UI (including those inherited from Project settings) are *not* auto-added to PRs created via the API. A client that wants to mimic the web UI's behavior has to read the default-reviewers endpoint and inline the result in its POST body.

### Workaround endpoint

`GET /repositories/{workspace}/{repo_slug}/effective-default-reviewers` returns the effective list — i.e. repo-level defaults *plus* those inherited from the project (generated.d.ts:5063–5128). This matches the list the Bitbucket UI shows under **Repository settings → Default reviewers**.

Response type: `paginated_default_reviewer_and_type` (generated.d.ts:24501–24519). Each value:

```ts
{
  type: string;
  reviewer_type?: string;                     // e.g. "repository", "project"
  user?: { uuid?: string; account_id?: string; nickname?: string; ... };
}
```

The sibling non-effective endpoint `GET /repositories/{workspace}/{repo_slug}/default-reviewers` (generated.d.ts:3648) returns only repo-level defaults and explicitly redirects readers to the effective one. Prefer `effective-default-reviewers` unless you specifically need to know which level a reviewer comes from.

### Implication for `bb pr create`

To match the web UI's behavior, `bb pr create` must:

1. Call `effective-default-reviewers` if no explicit reviewers were supplied.
2. Merge with any `--reviewer` flags.
3. Filter out the authenticated user (Bitbucket rejects a PR body where the author is also a reviewer).
4. Inline the resulting UUID list in the POST body.

## Resolving a user handle → UUID

**Nicknames cannot be resolved to UUIDs via the API.** The user schema explicitly says "nickname cannot be used in place of 'username' in URLs and queries, as 'nickname' is not guaranteed to be unique" (generated.d.ts:25795).

`GET /users/{selected_user}` (generated.d.ts:17740–17797) accepts only an **Atlassian Account ID** or a **UUID** (wrapped in curly braces). 404 on miss.

### Practical paths for `--reviewer <handle>`

None of these are great; pick based on UX priorities.

1. **Accept UUIDs / account IDs directly.** Zero extra API calls. Worst UX — users rarely know their own UUID.
2. **Enumerate workspace members, filter locally by `nickname` or `display_name`.** One paginated call (see next section), then local match. Nickname collisions are possible; display-name collisions are common. Needs a disambiguation UX (error out listing all matches).
3. **Filter by email.** `GET /workspaces/{workspace}/members` supports `q=user.email IN ("a@x.com")` — but only "if called by a workspace administrator, integration or workspace access token" (generated.d.ts:19020–19023). Not viable for non-admin users.
4. **Local alias map in bbcli config.** User writes `alice = "{uuid}"` once in their config; bbcli resolves `--reviewer alice` locally. No API calls. Requires a one-time setup step.

The effective-default-reviewers workaround plus a local alias map (option 4) probably gets 90% of real usage without needing handle resolution at all.

## Listing workspace/repo members

### `GET /workspaces/{workspace}/members`

generated.d.ts:19003–19092. Returns `paginated_workspace_memberships`.

- Pagination: `pagelen` default 10, max 100. No cursor — uses `next` link.
- Filtering: `q=user.email IN (...)` only, and only for admins/tokens. No `q=user.nickname="x"` according to the doc comment.
- Each membership carries `user: account` (so `user.uuid` and `user.account_id` are available).

### No direct "members of a repository" endpoint

Searched the spec — there is no `/repositories/{workspace}/{repo_slug}/members` or similar. Repo-level user relationships exist only as:

- Permissions: `GET /repositories/{workspace}/{repo_slug}/permissions-config/users` (not inspected in detail — check before using).
- Default reviewers (see above).

For a "list everyone who could review a PR" command, `/workspaces/{workspace}/members` is the closest primitive.

## Reusable primitives already in this repo

- `getCurrentUser(creds)` → `{ uuid, displayName }` at `src/backend/user/index.ts:25`. Wraps `GET /user`. Use this anywhere the spec needs "the authenticated user's UUID."
- `listWorkspaces(creds)` → `WorkspaceInfo[]` at `src/backend/workspaces/index.ts:25`. Wraps `GET /user/workspaces`. Fetches a single 100-item page.
- `createBitbucketClient(credentials)` at `src/shared/bitbucket-http/index.ts` — openapi-fetch client typed against `generated.d.ts`.

## Merging a pull request

Endpoint: `POST /repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/merge` (generated.d.ts:12016–12126).

### Request

- Query: `async?: boolean`. When true, returns `202` with a task-status URL in the `Location` header; client polls `/merge/task-status/{task_id}`. When false (default), blocks until merge completes or times out (API may still return 202 on long merges, same polling fallback). For CLI v1, sync mode is fine — merges are usually fast.
- Body: `pullrequest_merge_parameters` (generated.d.ts:24587–24601):
  ```ts
  {
    message?: string;               // commit message; max 128 KiB
    close_source_branch?: boolean;  // delete source branch on merge (remote-side only)
    merge_strategy?: "merge_commit" | "squash" | "fast_forward"
                   | "squash_fast_forward" | "rebase_fast_forward" | "rebase_merge";
  }
  ```

### The "default merge strategy" question

**Same footgun pattern as default reviewers:** if `merge_strategy` is omitted from the body, the API defaults to `"merge_commit"` (generated.d.ts:24595), **not** the strategy configured on the destination branch. That means merging via the raw API with no body ignores the repo/project settings users have in the web UI.

### Where the configured default actually lives

The default merge strategy is a **per-destination-branch** property, not a repo-wide one. It's attached to the `branch` schema (generated.d.ts:25951–25958):

```ts
branch: {
  merge_strategies?: [...];         // strategies allowed on PRs targeting this branch
  default_merge_strategy?: string;  // the branch-configured default
}
```

**Verified against a real repo (2026-04-15):** `default_merge_strategy` and `merge_strategies` are **NOT populated by default** on `GET /pullrequests/{id}`. The schema lists them as optional, and Bitbucket omits them from the default serialization. Both fields come back only when explicitly requested via the `fields` query parameter.

Working request:

```
GET /repositories/{ws}/{slug}/pullrequests/{id}?fields=%2Bdestination.branch.default_merge_strategy,%2Bdestination.branch.merge_strategies
```

(`%2B` is URL-encoded `+`; `fields=+foo` adds `foo` to the default response without dropping other fields.)

So the correct flow is:

1. `GET /pullrequests/{id}` **with `fields=+destination.branch.default_merge_strategy,+destination.branch.merge_strategies`** — read the default and the allowed list.
2. `POST /pullrequests/{id}/merge` with `{ merge_strategy: <that value>, ... }`.

No separate "repo settings" endpoint is needed. (There is no `/repositories/{...}/merge-strategy` endpoint — grep confirms.)

### Gotcha: `fields` is not declared in the OpenAPI spec

`GET /pullrequests/{id}` declares `query?: never` (generated.d.ts:10575–10577), even though Bitbucket's `fields` mechanism is supported across the whole API. The openapi-fetch client therefore won't accept a `fields` query via its typed API. Two ways to work around:

- **Cast the params**: `await client.GET("/.../pullrequests/{id}", { params: { path: ..., query: { fields: "..." } as any } });` — pragmatic, localized.
- **Raw fetch**: build the URL manually and attach `Authorization` via `basicAuthHeader(credentials)` from `src/shared/bitbucket-http/index.ts:18`. Same pattern that `paginate.ts` already uses to follow opaque `next` cursors.

The raw-fetch path is consistent with an existing precedent in the repo; recommend that over sprinkling `as any`.

### Fallback if the response comes back without the field

`default_merge_strategy` may be null or absent on branches where no default is configured via branch restrictions. In that case Bitbucket's own API default applies (`merge_commit`). The command should treat null the same as "no configured default" and fall back to `merge_commit` — or, if we want to be louder about it, error and require `--strategy` explicitly. Pick one; document it.

### Strategy validation (client-side, cheap)

`pullrequest.destination.branch.merge_strategies` gives the list of strategies **allowed** on that destination. If the user passes `--strategy squash` but the branch only allows `merge_commit`, fail locally with a clear error before POSTing, rather than letting the API return an opaque 400. Zero extra calls — the data's already in the PR fetch.

### `close_source_branch` semantics

- API-level: deletes the **remote** source branch after merge.
- The field default in the merge body is "whatever the PR was created with," which in turn defaults to `false` (generated.d.ts:24591).
- Bbcli's `--delete` flag should:
  - Pass `close_source_branch: true` to delete the remote branch (server-side).
  - Delete the local branch client-side with `git branch -d` after merge confirms, *only if the local branch matches the PR's source branch and is checked out on something else*. Handle the "deleting the branch you're currently on" case by checking out the destination branch first.
- If `close_source_branch` is omitted and the user doesn't pass `--delete`, behavior falls through to whatever the PR was created with — fine, but document the implicit behavior.

### Response codes

- `200` — merged synchronously; body is the updated `pullrequest`.
- `202` — merge running async (either because `async=true` or because the sync merge exceeded the timeout); Location header has the polling URL.
- `409` — refs changed mid-merge; safe to retry after re-fetching the PR.
- `555` — merge timed out; retry.

For CLI v1: follow `202` once via the Location header (simple polling loop with backoff). Handle `409` and `555` by surfacing a clear retry message, don't auto-retry.

## Approve / Unapprove / Request-changes

Three related endpoints, all scoped to a PR. All three ship together in BBC2-18.

- `POST /repositories/{ws}/{slug}/pullrequests/{id}/approve` (generated.d.ts:11068–11144) — approve as the authenticated user. No body. Returns `200` with a `participant` object.
- `DELETE /repositories/{ws}/{slug}/pullrequests/{id}/approve` (generated.d.ts:11145–11211) — redact the authenticated user's approval. No body. Returns `204`. **`400` if the PR is already merged.** Surface cleanly as an expected error path.
- `POST`/`DELETE /repositories/{ws}/{slug}/pullrequests/{id}/request-changes` (generated.d.ts:12329+) — third review state, "changes requested." Same shape as `/approve`. Separate from approval — a PR can have approvals and changes-requested from different reviewers simultaneously.

The spec doesn't document idempotency. Re-approving a PR already approved by the same user either returns `200` with the existing participant or errors — verify via smoke test. If it errors, swallow the "already approved" case to meet the ticket's idempotency requirement.

## Top-level PR comments

Endpoint: `POST /repositories/{ws}/{slug}/pullrequests/{id}/comments` (generated.d.ts:11213–11366).

Body: `pullrequest_comment` extends `comment` (generated.d.ts:23628–23663 for `comment`, 25939–25947 for `pullrequest_comment`). For a top-level comment, the only fields that matter are `content.raw` and `content.markup`:

```json
{ "content": { "raw": "LGTM with **nits**", "markup": "markdown" } }
```

`content.markup` accepts `"markdown" | "creole" | "plaintext"` (generated.d.ts:23641–23644). **Default to `"markdown"`** — it's a superset of plaintext and matches what the web UI does. Verify the server's implicit default via smoke test; if it already defaults to markdown, sending the field is harmless.

Returns `201` with the new comment and a `Location` header pointing at the comment's URL. Use that for the "confirmation with comment URL or ID" output in BBC2-17. Mirror the `--body` input pattern already established by `bb pr create` (per the comment on BBC2-17).

Inline comments (BBC2-22, separate ticket) use the same endpoint with an additional `inline: { path, to, from?, start_from?, start_to? }` field. Out of scope here.

## PR diff

Endpoint: `GET /repositories/{ws}/{slug}/pullrequests/{id}/diff` (generated.d.ts:11882–11947).

**This endpoint returns a `302` redirect** to `/repositories/{ws}/{slug}/diff/{spec}` where `spec` is the PR's commit range. The target (generated.d.ts:4383+) returns **raw `text/plain`** — a git-style unified diff, not JSON. Consequences:

- Don't call `.json()`. Use `.text()` (or equivalent).
- `createBitbucketClient` is typed as JSON-in/JSON-out. For this call either bypass the typed client and use a direct `fetch` with auth headers (same precedent as `paginate.ts` — see the raw-fetch note earlier in this doc), or override the response parser on the specific call.
- `openapi-fetch` follows redirects via the underlying `fetch` by default, so the 302 should transparently resolve to the final response.
- Content-type is `text/plain` and encoding is "whatever the files use" — not normalized to UTF-8. Pipe verbatim to stdout.

**Keep v1 simple:** no query-param flags initially. `/diff/{spec}` supports `context`, `path` (repeatable), `ignore_whitespace`, `binary`, `renames` — add later as needed.

For JSON mode, wrap as `{"diff": "..."}`. Don't parse into structured hunks; users pipe to `delta` or similar.

## Commit statuses on a PR (CI check summary)

Endpoint: `GET /repositories/{ws}/{slug}/pullrequests/{id}/statuses` (around generated.d.ts:12500; grep for `paginated_commitstatuses` if lines drift).

Returns `paginated_commitstatuses` — **all commit statuses for the PR's head commit in one paginated call**. This is the entire feature for BBC2-24. Do *not* fetch the PR first, extract the head SHA, and query `/commit/{sha}/statuses` separately — the PR-scoped endpoint already does that.

`commitstatus` schema (generated.d.ts:23695–23751):

```ts
{
  key: string;           // vendor-unique ID, e.g. "BB-DEPLOY"
  name?: string;         // human name, e.g. "BB-DEPLOY-1"
  description?: string;  // "Unit tests in Bamboo"
  state: "FAILED" | "INPROGRESS" | "STOPPED" | "SUCCESSFUL";
  url?: string;          // link back to the vendor
  refname?: string;
  created_on?: string;
  updated_on?: string;
}
```

Exit-code mapping for BBC2-24's "0 = all pass, non-zero = anything failing or pending":

- All `SUCCESSFUL` → exit 0.
- Any `FAILED` or `STOPPED` → exit 1 (failure).
- Any `INPROGRESS` and no failures → exit 2 (pending) — pick a consistent code and document.

### Pipelines ≠ commit statuses

Two different concepts in Bitbucket Cloud — don't conflate:

- **Commit statuses** (this endpoint) — reported by any CI vendor (BB Pipelines, Jenkins, external webhooks). The "is it green?" truth.
- **Pipelines** (`/repositories/{ws}/{slug}/pipelines/` family, generated.d.ts:9514+) — Bitbucket's own CI product, with steps, logs, `stopPipeline`, test reports.

BBC2-24 uses the former. BBC2-21/28/29 use the latter.

## Updating a PR (title, description, draft state)

Endpoint: `PUT /repositories/{ws}/{slug}/pullrequests/{id}` (generated.d.ts:10623+, within the PR-by-id path block).

- Body typed as the full `pullrequest` schema. Doc comment says "This can be used to change the pull request's branches or description." In practice partial bodies usually work on this API, but the spec doesn't formally guarantee it. **Smoke-test partial-body behavior before relying on it.** If it rejects partials, fetch the PR first and send the full merged body.
- **Only open PRs are mutable** (explicit in the doc comment). Already-merged or declined PRs 4xx.
- No dedicated "mark ready" action endpoint exists — grep confirms.

### BBC2-23 (edit title/description)

Send `{ title, description }`. If partial-body support is confirmed, straightforward.

### BBC2-25 (draft → ready)

Send `{ draft: false }`. The `draft` field exists on the schema (per BBC2-42's verification), but the PUT's doc comment only mentions "branches or description" — **confirm via smoke test that `draft` is actually a mutable field on update**, not just on create. If it isn't mutable via this endpoint, there's no other API path and the ticket would have to be dropped.

For idempotency ("calling it on an already-ready PR doesn't error"): if the PUT tolerates `{ draft: false }` on a non-draft PR (likely a no-op), fine. If it 4xx's, fetch first and short-circuit.

## How to extend this doc

When researching a new endpoint:

1. Grep `generated.d.ts` for the path anchor.
2. Read the `parameters`, `requestBody`, and `responses` blocks.
3. Follow `components["schemas"][...]` references for response shapes.
4. Add findings here with line number citations.
5. If the spec comment contradicts your prior assumption, say so explicitly — this doc exists to catch exactly those cases.
