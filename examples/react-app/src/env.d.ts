/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set at build time by scripts/demo.sh so every release changes the route chunks. */
  readonly VITE_RELEASE?: string
}

declare const __SKEWFORGE_DEPLOYMENT__: string
