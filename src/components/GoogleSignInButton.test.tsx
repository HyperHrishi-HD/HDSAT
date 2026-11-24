// @vitest-environment jsdom
/**
 * GIS personalises the button for returning visitors, and that "Continue as …"
 * variant is laid out wider than the button's box and clipped on a narrow card.
 * Google documents `medium` as the one size that is never personalised, so the
 * component must keep asking for it, and must not add a scaling layer of its
 * own on top of Google's artwork.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const renderButton = vi.fn(
  (parent: HTMLElement, _options: Record<string, unknown>) => {
    // A widened personalised wrapper, exactly like GIS draws it.
    const chip = document.createElement('div');
    chip.style.width = '396px';
    parent.appendChild(chip);
  }
);
const initialize = vi.fn();

vi.mock('../lib/googleIdentity', () => ({
  googleClientId: () => 'test-client.apps.googleusercontent.com',
  loadGoogleIdentity: () => Promise.resolve(),
}));

const { GoogleSignInButton } = await import('./GoogleSignInButton');

let container: HTMLDivElement;
let root: Root;
let hostWidth: number;
let widthSpy: PropertyDescriptor | undefined;

beforeEach(() => {
  window.google = {
    accounts: { id: { initialize, renderButton, cancel: vi.fn() } },
  };
  renderButton.mockClear();
  initialize.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  // jsdom has no layout: report the host box as the width the card would have.
  hostWidth = 0;
  widthSpy = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
  Object.defineProperty(Element.prototype, 'clientWidth', {
    configurable: true,
    get: () => hostWidth,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.google;
  if (widthSpy) Object.defineProperty(Element.prototype, 'clientWidth', widthSpy);
});

it('asks for the non-personalised medium button and leaves Google’s DOM alone', async () => {
  await act(async () => {
    root.render(<GoogleSignInButton onCredential={() => {}} onUnavailable={() => {}} />);
  });

  expect(initialize).toHaveBeenCalledTimes(1);
  expect(renderButton).toHaveBeenCalledTimes(1);
  const [host, options] = renderButton.mock.calls[0];
  expect(options).toMatchObject({
    type: 'standard',
    theme: 'filled_black',
    size: 'medium',
    shape: 'pill',
  });
  // jsdom has no layout, so the component falls back to its 320px request.
  expect(options.width).toBe(320);

  // The widened wrapper is passed through untouched: no transform, no scale
  // variable and no fitting layer around Google's own markup.
  expect(host.querySelector('div')?.style.width).toBe('396px');
  expect((host as HTMLElement).style.transform).toBe('');
  expect(getComputedStyle(host as HTMLElement).getPropertyValue('--gis-scale')).toBe('');
  expect(container.querySelector('.auth-google-gsi-slot')).toBeNull();
});

it('redraws at the new width when the card is resized, and only then', async () => {
  hostWidth = 366;
  await act(async () => {
    root.render(<GoogleSignInButton onCredential={() => {}} onUnavailable={() => {}} />);
  });
  expect(renderButton).toHaveBeenCalledTimes(1);
  expect(renderButton.mock.calls[0][1].width).toBe(366);

  // Same width: nothing to redraw, so Google's iframe is left alone.
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
  });
  expect(renderButton).toHaveBeenCalledTimes(1);

  // The modal (or viewport) narrows while it is open. GIS keeps the width it
  // was rendered at, so without a redraw the button would be clipped.
  hostWidth = 300;
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
  });
  expect(renderButton).toHaveBeenCalledTimes(2);
  const [host, options] = renderButton.mock.calls[1];
  expect(options.width).toBe(300);
  expect(host.childElementCount).toBe(1);
});
