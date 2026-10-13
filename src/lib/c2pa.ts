import { createC2pa, type C2pa } from '@contentauth/c2pa-web'
import wasmSrc from '@contentauth/c2pa-web/resources/c2pa.wasm?url'

// Module-level singleton so React StrictMode's double-invoked effects (and any
// other callers) all share the same worker/WASM instance instead of spawning more.
let instance: Promise<C2pa> | undefined

/** Lazily creates (once) and returns the local, in-browser C2PA engine. */
export function getC2pa(): Promise<C2pa> {
  if (!instance) {
    instance = createC2pa({ wasmSrc })
  }
  return instance
}
