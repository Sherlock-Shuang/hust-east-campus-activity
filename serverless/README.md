# Vercel activity API (Turso)

Copy the runtime `.mjs` files and `schema.sql` from this directory into the clean Vercel application's `serverless/`. It expects the existing sibling `server/audience-store.mjs`, `src/live-state.js`, `src/activity-catalog.js`, and `integration/tasay/proxy.mjs`; no Cloudflare/GPT hosting dependency is used. Do not copy node_modules or test output.

Install runtime dependency in the app root: `npm install @libsql/client@0.18.0`.

Vercel Native Turso provisioning: `vercel install tursocloud`. Its documented environment variables are `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Configure `ADMIN_PASSWORD` (at least 12 characters), and the existing `TASAY_LLM_*`/optional `TASAY_FAST_LLM_*` server secrets. Use separate database resources for production and preview. No credentials belong in GitHub, Vite public variables, or logs.

Once the integration has supplied the environment, migrate once: `node --env-file=.env.local serverless/migrate.mjs` (or provide the two database variables through the deployment environment and run `node serverless/migrate.mjs`). This applies idempotent CREATE TABLE/INDEX statements in one write transaction; it does not delete existing records. `.env.local` must remain ignored.

Create `api/activity.mjs` with this Node function entry:

```js
import { createNodeActivityHandler } from '../serverless/node-handler.mjs';
export default createNodeActivityHandler();
```

Configure `functions["api/activity.mjs"].maxDuration` as `300` in `vercel.json`, and enable Fluid compute. Place the static `/api/games` route before the catch-all API rewrite. Rewrite `/api/:path*` to `/api/activity?__activity_path=:path*`; the Node adapter validates and restores the original API path, removes the internal query parameter and preserves ordinary query parameters. The supported routes are `/api/live/*`, `/api/admin/*`, `/api/audience/*`, and `/api/works/tasay/*`. The model endpoint specifically remains `/api/works/tasay/{default|fast}/chat/completions`. All API responses are dynamic/no-store. Never allow a static/SPA fallback to return successful HTML for these API paths.

The SSE stream voluntarily closes at 240 seconds and removes its polling/lifetime timers and lease. Native EventSource reconnects and receives a full authoritative snapshot. There is no infinite process, in-memory authoritative session store, JSON filesystem persistence or dependency on a particular function instance. Polling stays at 1.5 seconds and heartbeat at 15 seconds. An abruptly killed function's lease expires within 45 seconds; reconnect does not change independent audience counts.

The SQL persistence format, per-audience revision CAS, live revision guard and atomic model reservation INSERT…SELECT are preserved from the tested SQLite backend. `batch()` is a write transaction. The model quota (6/min per person, 40/day per person, 500/day total) is shared across instances. The model proxy's per-instance concurrency cap is only additional local protection.

Serve heavy GLB/Unity/SWF/font resources through static/CDN routes, not this function. Keep HTML/JS entry documents and iframe adapters at the campus origin, exact manifest aliases and the ta-say SPA fallback. This module does not serve assets or manufacture a successful game completion signal.

Run the isolated adapter tests from the source checkout with `npm test --prefix deployment/vercel-api`. The 7 tests passed on 2026-10-27 using real local libSQL files and two independent clients/handlers. They verify SQL, persistence, auth/CSRF, CAS, duplicate identities, global quota concurrency, and all 240 seconds of the SSE lifecycle through an injected clock. A real Node HTTP server additionally verifies rewrite path recovery, JSON bodies, cookies, admin filter parameters and stream abort cleanup. The 100-audience / 100-SSE / 340-event test completed in 570 ms with event P95 95 ms in that local run. These are API and local SQLite results, not Turso network, WebGL or public deployment acceptance. Remote migration and deployed browser/HTTP verification are still required.

Official references checked 2026-10-27:
- https://vercel.com/marketplace/tursocloud
- https://vercel.com/docs/marketplace-storage
- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/functions/configuring-functions/duration
- https://vercel.com/docs/headers/request-headers
- https://docs.turso.tech/sdk/ts/reference
