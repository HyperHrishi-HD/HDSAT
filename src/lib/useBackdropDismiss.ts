import { useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

/**
 * Backdrop dismissal that survives a drag.
 *
 * A bare `onClick` on the backdrop is not enough. A click is dispatched on the
 * nearest common ancestor of where the press and the release happened, so
 * selecting text inside the dialog and letting go outside it produces a click
 * whose target is the backdrop — which closes the panel mid-selection. The
 * real question is where the press began, so this remembers that.
 *
 * Pointer events cover mouse, touch and pen alike, so the same guard protects
 * the phone layout without a second touch handler.
 */
export function useBackdropDismiss(onDismiss: () => void) {
  const pressedBackdrop = useRef(false);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    pressedBackdrop.current = event.target === event.currentTarget;
  };

  const onClick = (event: ReactMouseEvent<HTMLElement>) => {
    const startedOnBackdrop = pressedBackdrop.current;
    pressedBackdrop.current = false;
    if (startedOnBackdrop && event.target === event.currentTarget) onDismiss();
  };

  return { onPointerDown, onClick };
}
