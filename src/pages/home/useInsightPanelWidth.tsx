import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

const query = "(max-width: 1023px)";
const key = "okhub.home-insight-panel-width";
function subscribe(callback: () => void) {
  const media = window.matchMedia?.(query);
  media?.addEventListener("change", callback);
  return () => media?.removeEventListener("change", callback);
}
export function useInsightPanelWidth(host?: RefObject<HTMLElement | null>) {
  const narrow = useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? false, () => false);
  const [preferred, setPreferred] = useState(() => {
    try { const value = Number(localStorage.getItem(key)); return value >= 280 && value <= 520 ? value : 380; } catch { return 380; }
  });
  const [maximum, setMaximum] = useState(520);
  useEffect(() => {
    const measure = () => {
      const available = host?.current?.clientWidth;
      setMaximum(available ? Math.max(280, Math.min(520, available - 360)) : 520);
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (host?.current) observer?.observe(host.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [host]);
  const width = Math.round(Math.max(280, Math.min(maximum, preferred)));
  const drag = useRef<{ x: number; width: number } | null>(null);
  const update = (value: number) => {
    const next = Math.round(Math.max(280, Math.min(maximum, value)));
    setPreferred(next);
    try { localStorage.setItem(key, String(next)); } catch { /* Device-local preference is optional. */ }
  };
  const handle = <div className="home-insights__resize" role="separator" tabIndex={0} aria-label="분석 패널 너비 조절" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={maximum} aria-valuenow={width} aria-valuetext={`${width}px`}
    onKeyDown={event => {
      const next = event.key === "ArrowLeft" ? width + 16 : event.key === "ArrowRight" ? width - 16 : event.key === "Home" ? 280 : event.key === "End" ? maximum : null;
      if (next !== null) { event.preventDefault(); update(next); }
    }}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (drag.current) update(drag.current.width + drag.current.x - event.clientX); }}
    onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} />;
  return { narrow, width, handle };
}
