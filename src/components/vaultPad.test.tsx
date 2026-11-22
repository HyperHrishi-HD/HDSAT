// @vitest-environment jsdom
/**
 * The vault pad is the one control a phone player touches with two fingers at
 * once: hold right and jump, or hold jump to keep climbing. Pointer capture
 * lost the first finger when the second landed on iOS, so the pad reads real
 * touch events now. These tests drive that listener with two touch identifiers
 * and check that neither cancels the other, and that a thumb sliding from one
 * key to the next releases the old one.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultPad } from './RuneVault';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'elementFromPoint');
});

interface FakeTouch {
  identifier: number;
  clientX: number;
  clientY: number;
  target: EventTarget | null;
}

function touch(type: string, target: EventTarget, ...points: FakeTouch[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'changedTouches', { value: points });
  Object.defineProperty(event, 'touches', { value: points });
  act(() => {
    target.dispatchEvent(event);
  });
}

function point(id: number, target: EventTarget, x = 0, y = 0): FakeTouch {
  return { identifier: id, clientX: x, clientY: y, target };
}

function mount(onChange: (action: string, down: boolean) => void) {
  act(() => root.render(<VaultPad onChange={onChange} />));
  return {
    pad: container.querySelector('.vault-dpad')!,
    left: container.querySelector('[data-vault-action="left"]')!,
    right: container.querySelector('[data-vault-action="right"]')!,
    jump: container.querySelector('[data-vault-action="jump"]')!,
  };
}

describe('vault pad', () => {
  it('holds two fingers on two keys at once', () => {
    const changes: [string, boolean][] = [];
    const { left, jump, pad } = mount((action, down) => changes.push([action, down]));

    touch('touchstart', left, point(1, left));
    touch('touchstart', jump, point(2, jump));

    expect(changes).toContainEqual(['left', true]);
    expect(changes).toContainEqual(['jump', true]);

    // Lifting the walking thumb must not drop the jump the other finger holds.
    touch('touchend', pad, point(1, left));
    expect(changes).toContainEqual(['left', false]);
    expect(changes).not.toContainEqual(['jump', false]);

    touch('touchend', pad, point(2, jump));
    expect(changes).toContainEqual(['jump', false]);
  });

  it('keeps the jump held until the finger lifts', () => {
    const changes: [string, boolean][] = [];
    const { jump, pad } = mount((action, down) => changes.push([action, down]));

    touch('touchstart', jump, point(7, jump));
    // A touchmove that stays on the same key must not report a release: this
    // is the hold that makes the vault keep hopping and keep climbing.
    touch('touchmove', pad, point(7, jump, 0, 0));
    expect(changes.filter(([, down]) => !down)).toHaveLength(0);

    touch('touchcancel', pad, point(7, jump));
    expect(changes).toContainEqual(['jump', false]);
  });

  it('slides from one key to the next without both staying down', () => {
    const changes: [string, boolean][] = [];
    const { left, right, pad } = mount((action, down) => changes.push([action, down]));

    // jsdom has no elementFromPoint at all; define the one this test needs.
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: (x: number) => (x > 100 ? right : left),
    });

    touch('touchstart', left, point(3, left, 0, 0));
    touch('touchmove', pad, point(3, left, 999, 0));

    expect(changes).toContainEqual(['left', false]);
    expect(changes).toContainEqual(['right', true]);
  });
});
