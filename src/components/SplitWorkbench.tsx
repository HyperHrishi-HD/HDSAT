import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './ui';

export type PaneSide = 'left' | 'right';

export interface SplitPaneState {
  ratio: number;
  side: PaneSide;
}

const clampRatio = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

/**
 * Remembers how wide the tool pane is and which side it sits on, per device.
 * The full test, practice and the arcade each keep their own key so resizing
 * one never moves another.
 */
export function useSplitPane(
  storageKey: string,
  options: { ratio?: number; side?: PaneSide; minRatio?: number; maxRatio?: number } = {}
) {
  const { ratio = 50, side = 'left', minRatio = 28, maxRatio = 72 } = options;
  const [state, setState] = useState<SplitPaneState>(() => {
    if (typeof localStorage === 'undefined') return { ratio, side };
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return { ratio, side };
      const parsed = JSON.parse(raw) as Partial<SplitPaneState>;
      return {
        ratio: clampRatio(Number(parsed.ratio), minRatio, maxRatio),
        side: parsed.side === 'right' ? 'right' : 'left',
      };
    } catch {
      return { ratio, side };
    }
  });

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* storage full or unavailable: the in-memory pane state still works */
    }
  }, [state, storageKey]);

  const setRatio = useCallback(
    (next: number) => setState((prev) => ({ ...prev, ratio: clampRatio(next, minRatio, maxRatio) })),
    [minRatio, maxRatio]
  );
  const toggleSide = useCallback(
    () => setState((prev) => ({ ...prev, side: prev.side === 'left' ? 'right' : 'left' })),
    []
  );

  return { ...state, setRatio, toggleSide, minRatio, maxRatio };
}

/**
 * The one-button way to move the tool pane across: a curved arrow that points
 * where the pane will go. Icon only, no label, so it sits flush against the
 * "Calculator" control in every toolbar.
 */
export function PaneSwitch({
  side,
  onClick,
  className = '',
}: {
  side: PaneSide;
  onClick: () => void;
  className?: string;
}) {
  const label = side === 'left' ? 'Move the calculator to the right side' : 'Move the calculator to the left side';
  return (
    <button
      type="button"
      className={`pane-switch-btn${className ? ` ${className}` : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <Icon name="flip" size={16} />
    </button>
  );
}

interface SplitWorkbenchProps {
  /** The calculator / reference pane. */
  tool: React.ReactNode;
  /** The question or lesson pane. */
  main: React.ReactNode;
  side: PaneSide;
  ratio: number;
  minRatio?: number;
  maxRatio?: number;
  onRatioChange?: (ratio: number) => void;
  /** Hide the tool without unmounting it, so an embedded calculator keeps its graph. */
  toolVisible?: boolean;
  /**
   * On a phone the panes stack. A calculator stacks *below* the question (so the
   * question is never pushed off the first screen) while a passage stacks above.
   */
  toolKind?: 'calc' | 'content';
  /**
   * Tallest the workbench may be. When set, the height is measured against the
   * space actually left below it, so the calculator never runs off the bottom
   * of the screen on a laptop.
   */
  maxViewportHeight?: number;
  className?: string;
}

/**
 * Resizable two-pane workspace.
 *
 * The drag writes the split as a CSS custom property on the container in a
 * requestAnimationFrame, so moving the divider never re-renders the page (the
 * old implementation set React state on every mousemove, which stuttered badly
 * in the full-test runner). React state is only touched once, when the drag
 * ends. A full-surface shield keeps the pointer away from the embedded iframe
 * while dragging, which is what used to freeze the divider over the calculator.
 */
export function SplitWorkbench({
  tool,
  main,
  side,
  ratio,
  minRatio = 28,
  maxRatio = 72,
  onRatioChange,
  toolVisible = true,
  toolKind = 'content',
  maxViewportHeight,
  className = '',
}: SplitWorkbenchProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    rect: DOMRect;
    side: PaneSide;
    min: number;
    max: number;
  } | null>(null);
  const pendingX = useRef(0);
  const frame = useRef(0);
  const lastRatio = useRef(ratio);
  const [dragging, setDragging] = useState(false);
  const [switching, setSwitching] = useState(false);
  const previousSide = useRef(side);

  // Swapping sides is a layout change Flexbox cannot tween, so the panes are
  // eased in instead of snapping: a short fade keeps the switch calm.
  useEffect(() => {
    if (previousSide.current === side) return;
    previousSide.current = side;
    setSwitching(true);
    const timer = window.setTimeout(() => setSwitching(false), 260);
    return () => window.clearTimeout(timer);
  }, [side]);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (el) el.style.setProperty('--split', `${ratio}%`);
  }, [ratio]);

  // Fit the panes to the screen instead of a hard-coded height: the welcome
  // banner or a shorter laptop screen would otherwise push the bottom of the
  // calculator below the fold. Layout effect so the first paint is already the
  // final height and the pane never flashes at the fallback size.
  useLayoutEffect(() => {
    if (!maxViewportHeight) return;
    const el = rootRef.current;
    if (!el) return;
    let last = 0;
    const apply = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const height = Math.round(
        Math.max(420, Math.min(maxViewportHeight, window.innerHeight - top - 18))
      );
      if (height === last) return;
      last = height;
      el.style.setProperty('--fit-height', `${height}px`);
    };
    apply();
    window.addEventListener('resize', apply);
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    if (observer && document.body) observer.observe(document.body);
    return () => {
      window.removeEventListener('resize', apply);
      observer?.disconnect();
    };
  }, [maxViewportHeight]);

  const paint = useCallback(() => {
    frame.current = 0;
    const drag = dragRef.current;
    const el = rootRef.current;
    if (!drag || !el) return;
    let pct = ((pendingX.current - drag.rect.left) / drag.rect.width) * 100;
    // In row-reverse the tool sits on the right, so the pointer distance from
    // the left edge measures the question pane.
    if (drag.side === 'right') pct = 100 - pct;
    pct = clampRatio(pct, drag.min, drag.max);
    lastRatio.current = pct;
    el.style.setProperty('--split', `${pct}%`);
  }, []);

  const endDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (frame.current) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    }
    setDragging(false);
    if (Math.abs(lastRatio.current - ratio) > 0.01) onRatioChange?.(lastRatio.current);
  }, [onRatioChange, ratio]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!dragRef.current) return;
      pendingX.current = event.clientX;
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    };
    const onUp = () => endDrag();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [endDrag, paint]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (!el) return;
    event.preventDefault();
    dragRef.current = {
      rect: el.getBoundingClientRect(),
      side,
      min: minRatio,
      max: maxRatio,
    };
    lastRatio.current = ratio;
    pendingX.current = event.clientX;
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* synthetic pointers cannot be captured; window listeners still drive the drag */
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 2 : -2;
    const delta = side === 'right' ? -step : step;
    onRatioChange?.(clampRatio(ratio + delta, minRatio, maxRatio));
  };

  return (
    <div
      ref={rootRef}
      className={`split-workbench is-tool-${toolKind}${
        side === 'right' ? ' is-tool-right' : ''
      }${toolVisible ? '' : ' is-single'}${dragging ? ' is-dragging' : ''}${
        switching ? ' is-switching' : ''
      }${
        className ? ` ${className}` : ''
      }`}
      data-side={side}
    >
      <div className="split-tool" hidden={!toolVisible}>
        {tool}
      </div>
      {toolVisible ? (
        <div
          className="split-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the calculator and question panes"
          aria-valuemin={Math.round(minRatio)}
          aria-valuemax={Math.round(maxRatio)}
          aria-valuenow={Math.round(ratio)}
          tabIndex={0}
          title="Drag to resize · arrow keys nudge"
          onPointerDown={startDrag}
          onKeyDown={onKeyDown}
        >
          <span className="split-divider-grip" aria-hidden="true" />
        </div>
      ) : null}
      <div className="split-main">{main}</div>
      <div className="split-drag-shield" aria-hidden="true" />
    </div>
  );
}
