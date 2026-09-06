/**
 * Stands in for the `cloudflare:workers` module. Four server modules import
 * `env` from it at module scope, so the object identity must be stable: the
 * entry fills this one in before the worker bundle is loaded.
 */
export const env = {};
export function assignEnv(values) {
  Object.assign(env, values);
}
export class WorkerEntrypoint {}
export class DurableObject {}
export class RpcTarget {}
export function waitUntil() {}
