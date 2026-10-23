import { useEffect, useRef, useState, type RefObject } from "react";

const storageKey = "okhub.review-panel-width";
const minimum = 280;
const maximum = 520;

/** Device-local presentation preference, independent of document/PR data. */
export function useReviewPanelWidth(narrow: boolean, host: RefObject<HTMLElement | null>, ready: boolean) {
  const [preferred, setPreferred] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const value = raw === null ? NaN : Number(raw);
      return Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
    } catch { return null; }
  });
  const [available, setAvailable] = useState(maximum);
  useEffect(() => {
    const measure = () => {
      const element = host.current;
      if (narrow) { setAvailable(window.innerWidth); return; }
      if (!element || !element.clientWidth) return;
      const style = getComputedStyle(element);
      const inner = element.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");
      setAvailable(Math.max(minimum, inner - 360));
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (host.current) observer?.observe(host.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [narrow, host, ready]);
  const max = Math.min(maximum, available);
  const min = Math.min(minimum, max);
  const width = Math.round(Math.min(max, Math.max(min, preferred ?? (narrow ? 420 : 340))));
  const drag = useRef<{ x: number; width: number } | null>(null);
  const update = (value: number) => {
    const next = Math.round(Math.min(max, Math.max(min, value)));
    setPreferred(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* Storage may be unavailable. Resizing still works. */ }
  };
  const handle = <div className="document-review__resize" role="separator" tabIndex={0}
    aria-label="리뷰 패널 너비 조절" aria-orientation="vertical"
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} aria-valuetext={`${width}px`}
    onKeyDown={event => {
      const value = event.key === "ArrowLeft" ? width + 16 : event.key === "ArrowRight" ? width - 16 : event.key === "Home" ? min : event.key === "End" ? max : null;
      if (value !== null) { event.preventDefault(); update(value); }
    }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      drag.current = { x: event.clientX, width };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => { if (drag.current) update(drag.current.width + drag.current.x - event.clientX); }}
    onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onLostPointerCapture={() => { drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }}
  />;
  return { width, handle };
}
