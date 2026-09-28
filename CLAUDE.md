# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Self-hosted version skew protection. A gateway (Express 5) stores every deployment's files
content-addressed and serves each request from the right deployment. A CLI uploads builds with
blob dedupe. A browser runtime (with React and Vue bindings) learns about releases over SSE and
moves users over at the next navigation. There is also a Vite plugin and a React dashboard.
npm workspaces monorepo, TypeScript throughout.

## Commands

```bash
npm install                                # if ~/.npmrc has an unreachable proxy, use NPM_CONFIG_USERCONFIG=<clean npmrc>
npm test                                   # vitest, one root config, a project per workspace
npx vitest run --project server            # one package (core, server, cli, client, react, vue, vite, dashboard)
npx vitest run -t "rescues files"          # one test by name
npm run test:e2e                           # Playwright; global setup builds .demo/<app>-v1|v2 first
npx playwright install chromium            # once, before the first e2e run
npm run typecheck                          # tsc --noEmit per workspace (vue-tsc for the Vue example)
npm run lint                               # oxlint

npm run dev                                # gateway edge :8080 + admin :8081 (tsx watch), dashboard :5173
npm run demo                               # ship three releases of the React example to the dev gateway
npm run skewforge -- list                  # the CLI from source (needs SKEWFORGE_TOKEN=dev-admin-token)
bash scripts/build-release.sh react-app 2  # one release build into .demo/
npm run build                              # dashboard (Vite) + gateway and CLI (esbuild, self-contained files)
npx tsx scripts/screenshots.ts             # regenerate docs/screenshots (build the dashboard first)
docker compose up --build                  # gateway with a data volume
```

## Architecture

- `packages/core` is the source of truth for semantics: `resolve.ts` (which deployment serves a
  path), `version.ts` (what a tab running X should do), `retention.ts` (what GC may delete),
  `schema.ts` (Zod, admin API input). All pure. Browser code imports only
  `@skewforge/core/protocol` (no Zod) plus `import type` from the root.
- Internal packages export TypeScript source (`"exports": "./src/index.ts"`). Vite configs that
  import `@skewforge/vite` therefore need `--configLoader runner` (already in the example scripts).
- Gateway layering: `http/edge.ts` (public app + `/__skewforge` runtime endpoints) and
  `http/admin.ts` (bearer-auth API + dashboard static) only parse and map errors. `service.ts`
  owns the rules. Every registry mutation goes through `DeploymentService.mutate()`: serialized →
  clone → change → persist → swap in memory (rebuilding the `AssetIndex`) → emit `change`. The
  `VersionStreamHub` listens to `change` and pushes per-tab status only when it differs.
- Staged (never promoted) deployments are hidden from everyone except a signed preview cookie. Keep
  that invariant when touching resolution: pass `visible` into `resolveAsset`.
- The client's hard navigation is a capture-phase `click` listener on `window` that calls
  `stopImmediatePropagation()`. That is what keeps SPA routers from handling the click. Don't move
  it to `document` or to the bubble phase.
- `test/harness.ts` in the server builds a gateway on a temp dir with a controllable clock. The CLI
  tests run against a real listening gateway via `@skewforge/server/app`.

## Conventions

- Conventional commits (`feat(server): …`, `test(e2e): …`).
- Tests sit next to the code (`*.test.ts`). React Testing Library cleanup is explicit via
  `src/test/setup.ts` because Vitest globals are off.
- Deployment ids match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` and must be unique per build (the
  gateway answers 409 on reuse, like Next.js).
