/**
 * "ResizeObserver loop completed with undelivered notifications" is the browser
 * reporting that it ran out of resize passes in one frame and will finish on the
 * next. It is benign, but it surfaces as a window error event, which a dev
 * overlay shows as a crash.
 *
 * Rather than swallow the report, this removes the cause: observer callbacks are
 * deferred to the next animation frame, so a callback that changes layout no
 * longer runs inside the delivery loop it would retrigger. React Flow's
 * fit-to-view and the resizable panels are the observers that collide here.
 */
type Frames = {
  requestAnimationFrame: (fn: () => void) => number;
  ResizeObserver?: typeof ResizeObserver;
  __deferredResizeObserver?: boolean;
};
export function installDeferredResizeObserver(target: Frames): boolean {
  const Native = target.ResizeObserver;
  if (!Native || target.__deferredResizeObserver) return false;
  target.__deferredResizeObserver = true;
  target.ResizeObserver = class extends Native {
    constructor(callback: ResizeObserverCallback) {
      let pending = false;
      // Deliveries are coalesced, not dropped: entries queued while a frame is
      // pending are carried into the single flush, so no observation is lost.
      let queued: ResizeObserverEntry[] = [];
      super((entries, observer) => {
        queued = queued.concat(entries);
        if (pending) return;
        pending = true;
        target.requestAnimationFrame(() => {
          pending = false;
          const flushed = queued;
          queued = [];
          callback(flushed, observer);
        });
      });
    }
  };
  return true;
}
