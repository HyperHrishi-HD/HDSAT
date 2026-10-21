/**
 * Window-style resizing for floating panels (the math reference sheet).
 *
 * The helper is pure so every edge/corner rule is unit-tested: the opposite
 * edge stays pinned, the minimum size is respected, and the window never grows
 * past the viewport. Drag deltas come from pointer positions; callers only
 * apply the returned rectangle.
 */

export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Every resize handle, in the order they are rendered. */
export const RESIZE_DIRS: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ResizeArgs {
  dir: ResizeDir;
  /** Rectangle when the drag began. */
  start: Rect;
  /** Pointer travel since the drag began. */
  dx: number;
  dy: number;
  viewport: { width: number; height: number };
  minWidth?: number;
  minHeight?: number;
  /** Smallest gap kept between the window and the viewport edge. */
  margin?: number;
}

export function applyWindowResize({
  dir,
  start,
  dx,
  dy,
  viewport,
  minWidth = 260,
  minHeight = 180,
  margin = 8,
}: ResizeArgs): Rect {
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  let { x, y, w, h } = start;

  if (dir.includes('e')) {
    const maxW = Math.max(minWidth, viewport.width - start.x - margin);
    w = Math.min(maxW, Math.max(minWidth, start.w + dx));
  } else if (dir.includes('w')) {
    const maxW = Math.max(minWidth, right - margin);
    w = Math.min(maxW, Math.max(minWidth, start.w - dx));
    x = right - w;
  }

  if (dir.includes('s')) {
    const maxH = Math.max(minHeight, viewport.height - start.y - margin);
    h = Math.min(maxH, Math.max(minHeight, start.h + dy));
  } else if (dir.includes('n')) {
    const maxH = Math.max(minHeight, bottom - margin);
    h = Math.min(maxH, Math.max(minHeight, start.h - dy));
    y = bottom - h;
  }

  return {
    x: Math.max(margin, Math.round(x)),
    y: Math.max(margin, Math.round(y)),
    w: Math.round(w),
    h: Math.round(h),
  };
}
