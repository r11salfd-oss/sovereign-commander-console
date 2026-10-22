# Sovereign Commander Console

An Express + React + Vite application with a Node.js server that hosts the UI, the
REST/SSE API, and the MCP server process.

> **This is not a Google AI Studio app.** The previous contents of this file were an
> unmodified AI Studio template ("Run and deploy your AI Studio app", an `ai.studio/apps/...`
> link, and a `share-ais` banner). That template described a different product with a
> different runtime and a different credential story, and following it would not have
> produced a working checkout of this repository. It has been replaced with the
> commands that are actually verified to work here.

## Prerequisites

- **Node.js and npm.** This is an application server, not a static bundle. `npm run dev`
  executes `tsx server.ts`, which starts the Express server that serves both the API and
  the Vite client in development.
- **Docker** (optional), only for the container path described below.

## Environment

The key is **not** the only requirement, and it is **not** read only from `.env.local`.

Copy the provided template and fill it in:

```bash
cp .env.example .env.local   # Windows: copy .env.example .env.local
```

`.env.example` lists the primary runtime set: `PORT`, `NODE_ENV`, `CHAIN_KEY_ID`,
`GEMINI_API_KEY`, `GCP_PROJECT_ID`, `GCP_REGION`, and the Firebase credentials
(`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`). It also
documents every optional integration the server reads (the `GEMINI_API` alias, Azure
OpenAI, OpenCode/Zen, the host prober, and the fail-closed CLI token file). An empty
optional variable means the capability is disabled and says so; it is never silently
treated as configured.

Two details that the AI Studio template got wrong or omitted:

1. **The Gemini credential is accepted under two different variable names.**
   `server.ts` resolves `process.env.Gemini_API` **first** and only then falls back to
   `process.env.GEMINI_API_KEY` (`geminiClientService.ts` does the same). `.env.example`
   declares `GEMINI_API_KEY`. Setting only `Gemini_API` also works, and it takes
   precedence if both are set.

2. **Gemini runs server-side, in the Node process — not in the browser.** The
   `@google/genai` client is constructed in `server.ts` and is resolved at runtime from
   `node_modules`. Inside the container that means it runs under `node dist/server.cjs`
   with dependencies installed by `npm ci --omit=dev`. There is no browser-side Gemini
   client in use: `src/services/geminiClientService.ts` reads `process.env`, which is
   never populated in a browser bundle, and it is not imported anywhere in `src/`.
   Consequence: the browser never holds the key, and Gemini synthesis through
   `/api/forge/synthesize` requires the credential to be present in the **server's**
   environment.

Firebase credentials are required for the auth and Firestore-backed features; the server
starts without them, but those subsystems report themselves as unconfigured rather than
healthy.

## Run locally

```bash
npm install
npm run dev
```

## Build and run

```bash
npm run build   # vite build (client) + esbuild server.ts -> dist/server.cjs
npm start       # node dist/server.cjs
```

`npm run lint` and `npm run check` both run `tsc --noEmit` and must exit 0.

### Verify a production run

```bash
npm run build
PORT=3000 NODE_ENV=production npm start
curl -s http://127.0.0.1:3000/api/health   # HTTP 200 + JSON
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/   # 200 (SPA)
```

`/api/health` answers **200** when the kernel is up. With no model credentials it
reports `"status":"degraded"` and `"geminiGateway":"unconfigured"`, which is truthful:
the process is serving, the optional gateway is not configured. A non-200 or no answer
means the process is not up.

## Container

`Dockerfile` is a two-stage `node:20-alpine` build: the builder stage runs `npm ci` and
`npm run build`, the runner stage installs production dependencies with
`npm ci --omit=dev`, copies in `dist/` and `public/`, drops to the unprivileged `node`
user, and exposes port 3000 with `CMD ["node", "dist/server.cjs"]`.

## Deployment

`.github/workflows/deploy.yml` is `workflow_dispatch` only: a merge never deploys.
It fails loudly, by design, until the deployment path is provisioned. To make it
executable an operator must provide the repository secrets `GCP_SA_KEY` and
`GCP_PROJECT_ID` and approve the infrastructure decision; until then the workflow
reports `NOT YET WIRED` instead of a green check that deployed nothing.