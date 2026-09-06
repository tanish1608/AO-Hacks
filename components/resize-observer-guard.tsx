'use client';
import { installDeferredResizeObserver } from '@/lib/deferred-resize-observer';
if (typeof window !== 'undefined') installDeferredResizeObserver(window);
export default function ResizeObserverGuard() {
  return null;
}
