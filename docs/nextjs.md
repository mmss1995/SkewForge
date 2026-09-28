# Next.js (self-hosted)

Next.js has most of the pieces built in: `deploymentId` makes a client that talks to a newer
server fall back to a hard navigation. What it lacks outside Vercel is somewhere old static files
keep existing. SkewForge can be that place in **asset-only mode**.

## Recipe

1. Give every build a unique id, at build time *and* at runtime:

   ```js
   // next.config.js
   module.exports = { deploymentId: process.env.NEXT_DEPLOYMENT_ID }
   ```

2. After `next build`, ship the static output to SkewForge as an asset-only deployment:

   ```bash
   npx skewforge deploy .next/static \
     --id "$NEXT_DEPLOYMENT_ID" \
     --prefix _next/static \
     --immutable _next/static \
     --no-entry \
     --promote
   ```

   `--immutable _next/static` marks every file cacheable forever. Next names them by content or by
   build id, so that is safe.

3. Route `/_next/static/*` to the SkewForge edge and everything else to your Next.js servers:

   ```nginx
   location /_next/static/ { proxy_pass http://skewforge_edge; }
   location /              { proxy_pass http://nextjs; }
   ```

A tab that loaded the previous build can now still fetch its chunks while it lives. On its next
navigation the `deploymentId` mismatch triggers a hard reload onto the new build.

## What this does not cover (yet)

- **RSC payloads and Server Actions** of an old client still reach the new Node servers. Next.js
  handles an RSC mismatch with a hard navigation. A Server Action whose id changed between builds
  will fail. Full protection means running old server builds side by side and routing on
  `x-deployment-id`, which is on the [roadmap](../README.md#-roadmap).
- The `@skewforge/client` runtime works in a Next.js app, but since Next.js renders the HTML, the
  gateway cannot inject the deployment `<meta>`. Pass `deploymentId` to the client explicitly
  (for example from `process.env.NEXT_PUBLIC_DEPLOYMENT_ID`).
