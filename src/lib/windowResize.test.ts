import { describe, expect, it } from 'vitest';
import { applyWindowResize, RESIZE_DIRS, type Rect } from './windowResize';

const viewport = { width: 1200, height: 800 };
const start: Rect = { x: 300, y: 200, w: 400, h: 300 };

const resize = (dir: (typeof RESIZE_DIRS)[number], dx: number, dy: number, from: Rect = start) =>
  applyWindowResize({ dir, start: from, dx, dy, viewport });

describe('applyWindowResize', () => {
  it('offers every edge and corner handle', () => {
    expect([...RESIZE_DIRS].sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  });

  it('grows and shrinks from the east edge, pinning the left side', () => {
    expect(resize('e', 80, 999)).toEqual({ x: 300, y: 200, w: 480, h: 300 });
    expect(resize('e', -120, 0)).toEqual({ x: 300, y: 200, w: 280, h: 300 });
  });

  it('grows and shrinks from the south edge, pinning the top', () => {
    expect(resize('s', 999, 60)).toEqual({ x: 300, y: 200, w: 400, h: 360 });
    expect(resize('s', 0, -90)).toEqual({ x: 300, y: 200, w: 400, h: 210 });
  });

  it('pins the opposite edge when dragging west or north', () => {
    expect(resize('w', -60, 0)).toEqual({ x: 240, y: 200, w: 460, h: 300 });
    expect(resize('w', 70, 0)).toEqual({ x: 370, y: 200, w: 330, h: 300 });
    expect(resize('n', 0, -40)).toEqual({ x: 300, y: 160, w: 400, h: 340 });
    expect(resize('n', 0, 50)).toEqual({ x: 300, y: 250, w: 400, h: 250 });
  });

  it('resizes both axes from a corner', () => {
    expect(resize('se', 50, 40)).toEqual({ x: 300, y: 200, w: 450, h: 340 });
    expect(resize('nw', -50, -40)).toEqual({ x: 250, y: 160, w: 450, h: 340 });
    expect(resize('ne', 50, -40)).toEqual({ x: 300, y: 160, w: 450, h: 340 });
    expect(resize('sw', -50, 40)).toEqual({ x: 250, y: 200, w: 450, h: 340 });
  });

  it('never goes below the minimum window size', () => {
    expect(resize('e', -9999, 0).w).toBe(260);
    expect(resize('s', 0, -9999).h).toBe(180);
    expect(resize('n', 0, 9999)).toEqual({ x: 300, y: 320, w: 400, h: 180 });
  });

  it('keeps the window inside the viewport', () => {
    const east = resize('e', 5000, 0);
    expect(east.x + east.w).toBe(viewport.width - 8);
    const south = resize('s', 0, 5000);
    expect(south.y + south.h).toBe(viewport.height - 8);
    const west = resize('w', 5000, 0);
    expect(west.x).toBeGreaterThanOrEqual(8);
    expect(west.w).toBe(260);
  });
});
