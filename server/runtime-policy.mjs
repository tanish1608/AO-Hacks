/**
 * Resolve the listening interface before opening any socket.
 *
 * Identity now comes from a session cookie the application itself issues, so
 * a public interface is safe; it was not when the adapter trusted an upstream
 * proxy's headers. Binding stays opt-in so `npm run serve` on a laptop does
 * not quietly expose a workspace on the local network.
 */
export function runtimePolicy(config) {
  const host = config.HOST || '127.0.0.1';
  return { host };
}
