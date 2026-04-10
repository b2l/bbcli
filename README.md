# bbcli

A `gh`-equivalent CLI for Bitbucket Cloud. Work in progress.

## Install

```bash
bun install
```

## Run

```bash
bun run src/index.ts --help
```

## Configuration

bbcli reads its configuration from `$XDG_CONFIG_HOME/bbcli/config.json`
(falls back to `~/.config/bbcli/config.json`).

The config file carries your Atlassian email and a way to retrieve your
Bitbucket API token. Create an API token at
<https://id.atlassian.com/manage-profile/security/api-tokens>.

### Recommended: fetch the token from a command

The recommended form keeps the token out of the config file by having
bbcli run an external command to fetch it. On Linux with libsecret:

```json
{
  "email": "you@example.com",
  "token_command": [
    "secret-tool", "lookup",
    "service", "bbcli",
    "account", "bitbucket_api_token"
  ]
}
```

Then store the token in your keyring once:

```bash
secret-tool store --label='bbcli' \
    service bbcli account bitbucket_api_token
```

`token_command` is an argv array, not a shell string — no shell
interpretation. If you need a pipeline, use `["sh", "-c", "..."]`
explicitly. Any command that prints the token to stdout works:
`pass show bitbucket/token`, `op read "op://Private/Bitbucket/token"`,
`security find-generic-password -s bbcli -w` on macOS, and so on.

### Alternative: plaintext token in the config file

If you would rather keep the token directly in the config file:

```json
{
  "email": "you@example.com",
  "token": "ATATT3x..."
}
```

If you choose this form, lock down the file permissions:

```bash
chmod 600 ~/.config/bbcli/config.json
```

Exactly one of `token` or `token_command` must be set — bbcli errors if
both or neither are present.

## Verify your setup

```bash
bun run src/index.ts auth status
```

On success it prints `Logged in to Bitbucket Cloud as <name> (<email>)`.
If the credentials are missing or invalid, it prints an actionable
error and exits non-zero.

## Development

```bash
# Run all tests
bun test

# Regenerate the Bitbucket API types from Atlassian's OpenAPI spec
bun run generate:api
```

The generated schema lives at `src/shared/bitbucket-http/generated.d.ts`
and is committed. Re-run the generator when you need new endpoints or
when Atlassian publishes a spec update.
