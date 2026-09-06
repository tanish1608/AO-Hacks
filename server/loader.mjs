/** Resolves `cloudflare:workers` to the local shim so the Worker bundle loads on Node. */
const SHIM = new URL('./workers-shim.mjs', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers')
    return { url: SHIM, shortCircuit: true };
  return next(specifier, context);
}
