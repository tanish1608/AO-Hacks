/** Refuse the old shared public workspace before opening any database or socket. */
export function runtimePolicy(config) {
  const mode = config.AUTH_MODE || 'sites';
  if (!['sites', 'iap'].includes(mode)) throw new Error('AUTH_MODE must be sites or iap. Shared open workspaces are no longer supported.');
  const host = config.HOST || (mode === 'iap' ? '0.0.0.0' : '127.0.0.1');
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(host);
  if (mode === 'sites' && !loopback)
    throw new Error('The Node adapter cannot trust Sites identity headers on a public interface. Configure verified authentication before exposing it.');
  if (mode === 'iap' && !config.IAP_AUDIENCE)
    throw new Error('IAP_AUDIENCE is required for verified authentication.');
  return { host, mode };
}
