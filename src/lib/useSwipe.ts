import { useRef, useState, type PointerEvent as RPointerEvent } from "react";

const SWIPE_THRESHOLD = 60;

/**
 * Horizontal swipe on a pointer target. Vertical drags are left to the page so scrolling still works.
 * `dx` is the live drag offset, for anything that wants to follow the finger.
 * `wasSwipe()` is true just after a swipe ends, so a link under the finger can ignore that click.
 */
export function useSwipe({ onLeft, onRight }: { onLeft?: () => void; onRight?: () => void }) {
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; active: boolean; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (e: RPointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, active: false, moved: false };
  };
  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.2) {
        d.active = true;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } else if (Math.abs(my) > 10) {
        drag.current = null; // vertical intent: leave scrolling alone
        return;
      } else return;
    }
    d.moved = true;
    setDx(mx);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) {
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 50);
      if (dx <= -SWIPE_THRESHOLD) onLeft?.();
      else if (dx >= SWIPE_THRESHOLD) onRight?.();
    }
    setDx(0);
  };

  return {
    dx,
    wasSwipe: () => suppressClick.current,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
