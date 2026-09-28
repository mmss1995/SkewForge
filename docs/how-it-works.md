# How SkewForge works

## Deploying

`skewforge deploy dist` walks the build and hashes every file with SHA-256. It then asks the
gateway which of those hashes it does not have yet (`POST /api/blobs/missing`), uploads only those
(`PUT /api/blobs/:sha256`, streamed, verified against the hash on arrival), and finally registers
the deployment with a manifest:

```json
{
  "id": "4c1401f3-mulput7g",
  "entry": "index.html",
  "files": {
    "index.html":               { "hash": "…", "size": 470,   "type": "text/html; charset=utf-8", "immutable": false },
    "assets/vendor-DenLZjY-.js": { "hash": "…", "size": 253112, "type": "text/javascript; charset=utf-8", "immutable": true }
  },
  "meta": { "commit": "4c1401f3…", "branch": "main", "message": "feat: catalog filters" },
  "promote": true
}
```

Blobs are content-addressed (`blobs/<first two hex chars>/<sha256>`), so an unchanged vendor chunk
costs one hash lookup per deploy and is stored once. The registry is a single JSON file, replaced
atomically. Every mutation (create, promote, rollback, GC) runs one at a time on a copy, then the
copy is persisted, swapped in and announced.

## Serving a request

Page routes (an extensionless path or `.html` that accepts HTML) get the **current** deployment's
entry document, with `<meta name="skewforge-deployment" content="<id>">` injected and
`Cache-Control: no-cache`. A browser holding a valid preview cookie gets the previewed deployment.

Files are resolved by `resolveAsset()` in `packages/core/src/resolve.ts`, most specific signal first:

| # | Signal | Why |
|---|---|---|
| 1 | **Pin**: `?dpl=<id>`, `x-skewforge-deployment: <id>`, or the preview cookie | The client knows best. Use it for `fetch()` of non-fingerprinted files via `client.deploymentHeaders()`. |
| 2 | **Referer** | A module script's request carries the importing module's URL. If `assets/index-v1.js` imports `./remoteEntry.js`, the gateway serves `remoteEntry.js` from a deployment that contains `index-v1.js`, preferring the current one when the importer is shared. This is what makes non-fingerprinted files (Module Federation remotes, `manifest.json`) consistent without any build changes. |
| 3 | **Current deployment** | The normal case. |
| 4 | **Newest retained deployment that has the path** | The rescue: a chunk that only an older build still has. |

A request answered at step 4 while the current deployment lacks the file is counted as
**rescued**: a plain static server would have returned 404 (or worse, `index.html`) and the tab
would have crashed. A file that no retained deployment has is counted as **lost**. That means
retention is too aggressive.

Fingerprinted files (`name-HASH8+.ext`) are served with `Cache-Control: public, max-age=31536000,
immutable`. Everything else gets `no-cache` plus an ETag equal to the blob hash. Shared caches
therefore always revalidate them, which matters because the same path can hold different content
per deployment.

Staged deployments (never promoted) are invisible to everyone without a preview cookie, even
through `?dpl=`. Preview links are `/__skewforge/preview/<id>?sig=<HMAC(ADMIN_TOKEN, id)>`.

## Telling the tab

Each tab opens `GET /__skewforge/stream?running=<id>` (SSE). After every registry change the
gateway computes `versionStatus(registry, running)` per distinct `running` value and pushes it,
but only to tabs whose status actually changed:

| Situation | `updateAvailable` | `mandatory` | `reason` |
|---|---|---|---|
| running the current deployment | false | false | `up-to-date` |
| a newer deployment is current | true | false | `update` |
| a deployment promoted after `running` was last current is mandatory | true | true | `mandatory` |
| `running` was rolled back (revoked) | true | true | `revoked` |
| `running` no longer exists (GC'd) | true | true | `unknown` |
| `running` was never promoted | false | false | `preview` |

The client (`packages/client/src/client.ts`) reacts as follows:

- **update**: installs a capture-phase click listener on `window`. The next same-origin, unmodified
  left click on a link stops propagating before any router sees it, so the browser performs a real
  navigation and loads the new deployment. Back/forward reloads. `installSkewRouterGuard` covers
  Vue Router's programmatic `router.push()`; `client.hardNavigateIfUpdated(href)` covers anything
  else.
- **mandatory / revoked / unknown**: reloads immediately (configurable with `onMandatory`).
- If streaming is refused (the EventSource closes), it falls back to polling `GET /version`. A 404
  there means there is no gateway (a Vite dev server, for example), and the client goes quiet.

## Keeping deployments alive long enough

Tabs send `POST /__skewforge/beacon {session, deployment}` every 60 s while visible, plus a
`/beacon/end` on `pagehide`. `planRetention()` deletes a deployment only if **all** of these hold:

- it is not current;
- it is outside the newest `RETENTION_KEEP_LAST`;
- it stopped being current more than `RETENTION_MIN_AGE` ago (or was created that long ago, if never promoted);
- no tab has reported it within `SESSION_TTL` (unless `RETENTION_PROTECT_ACTIVE=false`).

After removing deployments, blobs no remaining deployment references are deleted. Blobs younger
than one hour are spared, because they may belong to a deploy that is still uploading.

## When everything else fails

If a chunk still cannot load (it was deleted, or the network dropped it), the client catches
`vite:preloadError`, unhandled rejections and error events that match the chunk-error messages of
Chromium, Firefox, Safari, webpack and Turbopack, and reloads once. A timestamp in
`sessionStorage` prevents a reload loop when the failure is a real outage.
