import { build } from 'esbuild'

// A single dependency-free file, so `npx @skewforge/cli` in CI installs nothing else.
await build({
  entryPoints: { skewforge: 'src/bin.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minifySyntax: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
})
