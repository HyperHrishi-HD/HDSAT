import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { applyWindowResize, RESIZE_DIRS, type Rect, type ResizeDir } from '../lib/windowResize';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Height the bottom tab bar takes on a phone; the window must never hide behind it. */
const mobileReserve = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches ? 78 : 0;

function defaultGeometry(width: number, height: number, placement: 'top' | 'bottom' = 'top'): Rect {
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const w = Math.min(width, Math.max(260, vw - 32));
  const h = Math.min(height, Math.max(180, vh - 140));
  const reserve = mobileReserve();
  return {
    w: Math.round(w),
    h: Math.round(h),
    x: Math.max(8, Math.round(vw - w - 28)),
    y:
      placement === 'bottom'
        ? Math.max(8, Math.round(vh - h - 24 - reserve))
        : Math.max(8, Math.min(76, vh - h - 40 - reserve)),
  };
}

function fitToViewport(rect: Rect): Rect {
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const reserve = mobileReserve();
  const w = Math.min(rect.w, Math.max(260, vw - 24));
  const h = Math.min(rect.h, Math.max(180, vh - 24 - reserve));
  return {
    w: Math.round(w),
    h: Math.round(h),
    x: Math.round(clamp(rect.x, 8, Math.max(8, vw - w - 8))),
    y: Math.round(clamp(rect.y, 8, Math.max(8, vh - h - 8 - reserve))),
  };
}

/**
 * A draggable, resizable floating tool window.
 *
 * The header moves it; every edge and corner resizes it, exactly like a desktop
 * window, with the corner nubs as the only visible affordance. Geometry is
 * written straight to the DOM inside a requestAnimationFrame while the pointer
 * is down, so dragging an embedded Desmos graph never re-renders the page. State
 * only catches up when the gesture ends, and the size/position are remembered
 * per window so the student's preferred layout survives a reload.
 */
export function FloatingToolWindow({
  title,
  children,
  onClose,
  storageKey,
  defaultWidth = 720,
  defaultHeight = 520,
  placement = 'top',
  minWidth = 260,
  minHeight = 180,
  className = '',
  testId,
  bodyClassName = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  storageKey?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  /** Where a window with no saved geometry opens. */
  placement?: 'top' | 'bottom';
  minWidth?: number;
  minHeight?: number;
  className?: string;
  testId?: string;
  bodyClassName?: string;
}) {
  const [geometry, setGeometry] = useState<Rect>(() => {
    const fallback = defaultGeometry(defaultWidth, defaultHeight, placement);
    if (!storageKey || typeof localStorage === 'undefined') return fallback;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<Rect>;
      if ([parsed.x, parsed.y, parsed.w, parsed.h].some((n) => typeof n !== 'number')) {
        return fallback;
      }
      return fitToViewport({
        x: Number(parsed.x),
        y: Number(parsed.y),
        w: Math.max(minWidth, Number(parsed.w)),
        h: Math.max(minHeight, Number(parsed.h)),
      });
    } catch {
      return fallback;
    }
  });
  const [interacting, setInteracting] = useState<null | 'drag' | 'resize'>(null);
  const [activeDir, setActiveDir] = useState<ResizeDir | null>(null);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const geometryRef = useRef(geometry);
  const dragRef = useRef<{
    mode: 'drag' | 'resize';
    dir?: ResizeDir;
    start: Rect;
    px: number;
    py: number;
  } | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const frameRef = useRef(0);

  geometryRef.current = geometry;

  const paintGeometry = useCallback((next: Rect) => {
    const el = boxRef.current;
    if (!el) return;
    el.style.left = `${next.x}px`;
    el.style.top = `${next.y}px`;
    el.style.width = `${next.w}px`;
    el.style.height = `${next.h}px`;
  }, []);

  const commit = useCallback(
    (next: Rect) => {
      geometryRef.current = next;
      paintGeometry(next);
      setGeometry(next);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* storage unavailable: the window still works for this session */
        }
      }
    },
    [paintGeometry, storageKey]
  );

  const begin = (event: React.PointerEvent<HTMLElement>, mode: 'drag' | 'resize', dir?: ResizeDir) => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { mode, dir, start: geometryRef.current, px: event.clientX, py: event.clientY };
    pointerRef.current = { x: event.clientX, y: event.clientY };
    setInteracting(mode);
    setActiveDir(dir ?? null);
    try {
      // Capture matters: the moment the pointer crosses the embedded Desmos
      // iframe, the frame would swallow every move and the gesture would freeze.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* synthetic pointers cannot be captured; window listeners still drive it */
    }
  };

  useEffect(() => {
    if (!interacting) return;
    const paint = () => {
      frameRef.current = 0;
      const drag = dragRef.current;
      if (!drag) return;
      const { x, y } = pointerRef.current;
      const dx = x - drag.px;
      const dy = y - drag.py;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const reserve = mobileReserve();
      if (drag.mode === 'drag') {
        paintGeometry({
          ...drag.start,
          x: Math.round(clamp(drag.start.x + dx, 8, Math.max(8, vw - drag.start.w - 8))),
          y: Math.round(
            clamp(drag.start.y + dy, 8, Math.max(8, vh - drag.start.h - 8 - reserve))
          ),
        });
      } else if (drag.dir) {
        paintGeometry(
          applyWindowResize({
            dir: drag.dir,
            start: drag.start,
            dx,
            dy,
            viewport: { width: vw, height: vh - reserve },
            minWidth,
            minHeight,
          })
        );
      }
    };

    const onMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      if (!frameRef.current) frameRef.current = requestAnimationFrame(paint);
    };
    const onUp = () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      const el = boxRef.current;
      dragRef.current = null;
      setInteracting(null);
      setActiveDir(null);
      if (!el) return;
      commit({
        x: Math.round(el.offsetLeft),
        y: Math.round(el.offsetTop),
        w: Math.round(el.offsetWidth),
        h: Math.round(el.offsetHeight),
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [commit, interacting, minHeight, minWidth, paintGeometry]);

  // A smaller viewport (rotation, window resize, browser zoom) pulls the window
  // back inside rather than leaving it half off-screen.
  useEffect(() => {
    const onResize = () => {
      const next = fitToViewport(geometryRef.current);
      const prev = geometryRef.current;
      if (next.x === prev.x && next.y === prev.y && next.w === prev.w && next.h === prev.h) return;
      commit(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [commit]);

  return (
    <div
      ref={boxRef}
      className={`bb-floating-modal bb-ref-window${interacting ? ' is-dragging' : ''}${
        className ? ` ${className}` : ''
      }`}
      style={{ left: geometry.x, top: geometry.y, right: 'auto', width: geometry.w, height: geometry.h }}
      data-testid={testId}
      role="dialog"
      aria-label={title}
    >
      <div
        className="bb-floating-head bb-ref-drag-handle"
        onPointerDown={(event) => begin(event, 'drag')}
      >
        <span>{title}</span>
        <button type="button" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}>
          ✕
        </button>
      </div>
      <div className={`bb-floating-body bb-ref-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>
        {children}
      </div>

      {RESIZE_DIRS.map((dir) => (
        <span
          key={dir}
          className={`bb-ref-resizer is-${dir}`}
          onPointerDown={(event) => begin(event, 'resize', dir)}
          aria-hidden="true"
        />
      ))}

      {/* While a gesture runs, a transparent shield keeps the pointer away from
          the embedded Desmos iframe, which would otherwise swallow the moves. */}
      {interacting ? (
        <div
          className={`bb-window-shield is-${interacting}${
            activeDir ? ` is-${activeDir}` : ''
          }`}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}
