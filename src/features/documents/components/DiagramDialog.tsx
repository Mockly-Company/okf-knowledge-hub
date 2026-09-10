import { useMemo, useRef, useState, type PointerEvent } from "react";
import { Maximize, Minus, Plus, RotateCcw } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

export interface DiagramDialogProps {
  /** SVG already sanitized by MermaidBlock; never raw Markdown or renderer output. */
  svg: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}

const clampZoom = (zoom: number) => Math.min(3, Math.max(0.5, zoom));
type View = { zoom: number; x: number; y: number };
type Drag = { pointerId: number; clientX: number; clientY: number; x: number; y: number };

function dimensions(svg: string) {
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const box = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
    return { width: box[2], height: box[3] };
  }
  const width = Number.parseFloat(root.getAttribute("width") ?? "");
  const height = Number.parseFloat(root.getAttribute("height") ?? "");
  return {
    width: Number.isFinite(width) && width > 0 ? width : 640,
    height: Number.isFinite(height) && height > 0 ? height : 320,
  };
}

export function DiagramDialog({ svg, open, onOpenChange }: DiagramDialogProps) {
  const size = useMemo(() => dimensions(svg), [svg]);
  const canvas = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  function center(zoom: number) {
    const bounds = canvas.current;
    if (!bounds) return;
    setView({
      zoom,
      x: (bounds.clientWidth - size.width * zoom) / 2,
      y: (bounds.clientHeight - size.height * zoom) / 2,
    });
  }

  function fit() {
    const bounds = canvas.current;
    if (!bounds) return;
    center(clampZoom(Math.min(
      (bounds.clientWidth - 48) / size.width,
      (bounds.clientHeight - 48) / size.height,
    )));
  }

  function zoomBy(step: number) {
    const bounds = canvas.current;
    if (!bounds) return;
    setView((current) => {
      const zoom = clampZoom(current.zoom + step);
      const ratio = zoom / current.zoom;
      return {
        zoom,
        x: bounds.clientWidth / 2 - (bounds.clientWidth / 2 - current.x) * ratio,
        y: bounds.clientHeight / 2 - (bounds.clientHeight / 2 - current.y) * ratio,
      };
    });
  }

  function stopDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="fullscreen"
        className="diagram-dialog"
        aria-describedby={undefined}
        onOpenAutoFocus={() => {
          returnFocus.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
          drag.current = null;
          setDragging(false);
          center(1);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">다이어그램 크게 보기</DialogTitle>
        <div className="diagram-dialog__toolbar">
          <div className="diagram-dialog__controls" role="group" aria-label="다이어그램 보기 조정">
            <Button type="button" variant="secondary" onClick={fit}>
              <Maximize aria-hidden="true" strokeWidth={1.75} />화면에 맞춤
            </Button>
            <IconButton label="축소" tooltip={false} disabled={view.zoom <= 0.5} onClick={() => zoomBy(-0.25)}>
              <Minus aria-hidden="true" strokeWidth={1.75} />
            </IconButton>
            <output className="diagram-dialog__percentage" aria-label="확대 비율" aria-live="polite">
              {Math.round(view.zoom * 100)}%
            </output>
            <IconButton label="확대" tooltip={false} disabled={view.zoom >= 3} onClick={() => zoomBy(0.25)}>
              <Plus aria-hidden="true" strokeWidth={1.75} />
            </IconButton>
            <IconButton label="100%로 초기화" tooltip={false} onClick={() => center(1)}>
              <RotateCcw aria-hidden="true" strokeWidth={1.75} />
            </IconButton>
          </div>
          <DialogCloseButton label="다이어그램 닫기" />
        </div>
        <div
          ref={canvas}
          className="diagram-dialog__canvas"
          role="region"
          aria-label="다이어그램 캔버스"
          data-dragging={dragging}
          onPointerDown={(event) => {
            if (event.button !== 0 || drag.current) return;
            event.preventDefault();
            drag.current = {
              pointerId: event.pointerId,
              clientX: event.clientX,
              clientY: event.clientY,
              x: view.x,
              y: view.y,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start || start.pointerId !== event.pointerId) return;
            setView((current) => ({
              ...current,
              x: start.x + event.clientX - start.clientX,
              y: start.y + event.clientY - start.clientY,
            }));
          }}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onLostPointerCapture={() => {
            drag.current = null;
            setDragging(false);
          }}
        >
          <div
            className="diagram-dialog__svg mermaid-theme"
            style={{
              width: size.width,
              height: size.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
