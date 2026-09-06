import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDeferredResizeObserver } from '../lib/deferred-resize-observer.ts';
type Cb = (entries: unknown[], observer: unknown) => void;
/** Minimal stand-in for the browser surface the shim patches. */
function browser() {
  const frames: (() => void)[] = [];
  let native: Cb | null = null;
  class NativeRO {
    constructor(cb: Cb) {
      native = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const target = {
    ResizeObserver: NativeRO as unknown as typeof ResizeObserver,
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
  };
  return {
    target,
    frames,
    deliver: (entries: unknown[]) => native!(entries, null),
    flush: () => {
      const pending = frames.splice(0);
      for (const f of pending) f();
    },
  };
}
void test('resize callbacks run after the delivery loop, not inside it', () => {
  const b = browser();
  assert.equal(installDeferredResizeObserver(b.target), true);
  const seen: unknown[][] = [];
  new (b.target.ResizeObserver as unknown as new (cb: Cb) => object)(
    (entries) => seen.push(entries),
  );
  b.deliver([{ id: 'a' }]);
  // Running the callback during delivery is what triggers the browser warning.
  assert.equal(seen.length, 0, 'callback must not run synchronously');
  b.flush();
  assert.equal(seen.length, 1);
});
void test('deliveries coalesced into one frame keep every entry', () => {
  const b = browser();
  installDeferredResizeObserver(b.target);
  const seen: unknown[][] = [];
  new (b.target.ResizeObserver as unknown as new (cb: Cb) => object)(
    (entries) => seen.push(entries),
  );
  b.deliver([{ id: 'a' }]);
  b.deliver([{ id: 'b' }]);
  assert.equal(b.frames.length, 1, 'a second delivery must not queue a frame');
  b.flush();
  assert.equal(seen.length, 1, 'one flush for both deliveries');
  assert.deepEqual(seen[0], [{ id: 'a' }, { id: 'b' }], 'no entry dropped');
  // A later delivery starts a fresh frame rather than reusing the drained queue.
  b.deliver([{ id: 'c' }]);
  b.flush();
  assert.deepEqual(seen[1], [{ id: 'c' }]);
});
void test('patching is idempotent and a no-op without ResizeObserver', () => {
  const b = browser();
  assert.equal(installDeferredResizeObserver(b.target), true);
  const once = b.target.ResizeObserver;
  assert.equal(installDeferredResizeObserver(b.target), false);
  assert.equal(b.target.ResizeObserver, once, 'must not double-wrap');
  assert.equal(
    installDeferredResizeObserver({
      requestAnimationFrame: (fn: () => void) => {
        fn();
        return 0;
      },
    }),
    false,
    'server rendering has no ResizeObserver to patch',
  );
});
