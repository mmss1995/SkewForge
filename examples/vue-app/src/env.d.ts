/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set at build time by scripts/demo.sh so every release changes the route chunks. */
  readonly VITE_RELEASE?: string
}

declare const __SKEWFORGE_DEPLOYMENT__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}
