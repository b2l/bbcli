import { beforeAll, afterEach, afterAll } from "bun:test";
import { setupServer } from "msw/node";

/**
 * Shared msw server for all backend tests. Import `server` to register
 * per-test handlers via `server.use(...)`, and call `setupMsw()` once at
 * the top of each test file to wire the lifecycle hooks.
 *
 * Unhandled requests throw: silent network calls in a unit test are almost
 * always a bug (forgotten handler, typo in URL) that we'd rather see loudly.
 */
export const server = setupServer();

export function setupMsw(): void {
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
}

export const BITBUCKET_BASE = "https://api.bitbucket.org/2.0";
