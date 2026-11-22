// @vitest-environment jsdom
/**
 * Selecting text inside a dialog and letting go over the backdrop used to close
 * the dialog, because the browser dispatches that click on the backdrop. The
 * guard here is about where the press began, not where the click landed.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackdropDismiss } from './useBackdropDismiss';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const onDismiss = vi.fn();

function Panel() {
  const backdrop = useBackdropDismiss(onDismiss);
  return (
    <div className="modal-backdrop" data-testid="backdrop" {...backdrop}>
      <div className="modal-card" data-testid="card">
        <p>Select me</p>
      </div>
    </div>
  );
}

let container: HTMLDivElement;
let root: Root;

function fire(type: 'pointerdown' | 'click', target: Element) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
    );
  });
}

const backdrop = () => container.querySelector('[data-testid="backdrop"]') as HTMLElement;
const card = () => container.querySelector('[data-testid="card"]') as HTMLElement;

beforeEach(() => {
  onDismiss.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Panel />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useBackdropDismiss', () => {
  it('closes when the press itself starts on the backdrop', () => {
    fire('pointerdown', backdrop());
    fire('click', backdrop());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stays open when the press starts inside the card and is released outside', () => {
    fire('pointerdown', card());
    // The release lands on the backdrop, which is where the browser reports the
    // click for a drag that began inside the card.
    fire('click', backdrop());
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('stays open for a press inside the card that ends inside the card', () => {
    fire('pointerdown', card());
    fire('click', card());
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not carry a stale press into the next interaction', () => {
    fire('pointerdown', card());
    fire('click', backdrop());
    expect(onDismiss).not.toHaveBeenCalled();
    fire('pointerdown', backdrop());
    fire('click', backdrop());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
