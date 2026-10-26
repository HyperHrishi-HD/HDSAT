import { useEffect, type RefObject } from 'react';

/**
 * Size a fixed-resolution canvas to the box it lives in.
 *
 * The games draw at 900×460 (or 900×480) in their own coordinates, and a canvas
 * element with `width:100%` either keeps its intrinsic size in the middle of a
 * wide screen (black bands down each side) or stretches and distorts the
 * plane. Measuring the box and writing an explicit pixel size keeps the drawing
 * ratio exact and uses every pixel the layout offers — inline, and edge to edge
 * in full screen.
 */
export function useCanvasFit(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  boxRef: RefObject<HTMLElement | null>,
  width: number,
  height: number,
  active = true
) {
  useEffect(() => {
    if (!active || typeof ResizeObserver === 'undefined') return;
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;

    let frame = 0;
    const fit = () => {
      frame = 0;
      const rect = box.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const scale = Math.min(rect.width / width, rect.height / height);
      const nextWidth = Math.round(width * scale);
      const nextHeight = Math.round(height * scale);
      if (
        canvas.style.width === `${nextWidth}px` &&
        canvas.style.height === `${nextHeight}px`
      ) {
        return;
      }
      canvas.style.width = `${nextWidth}px`;
      canvas.style.height = `${nextHeight}px`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };

    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(box);
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active, boxRef, canvasRef, height, width]);
}
