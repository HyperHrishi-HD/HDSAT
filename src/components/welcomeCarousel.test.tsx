// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WELCOME_SLIDES, WelcomeCarousel } from './WelcomeCarousel';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render() {
  act(() => {
    root.render(<WelcomeCarousel />);
  });
}

function caption() {
  return container.querySelector('.welcome-carousel-copy strong')?.textContent;
}

function button(label: string) {
  return [...container.querySelectorAll('button')].find(
    (item) => item.getAttribute('aria-label') === label
  ) as HTMLButtonElement | undefined;
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('WelcomeCarousel', () => {
  it('renders every screenshot as a 3D slide', () => {
    render();
    expect(WELCOME_SLIDES.length).toBeGreaterThanOrEqual(10);
    const cards = container.querySelectorAll('.welcome-carousel-card');
    expect(cards).toHaveLength(WELCOME_SLIDES.length);
    expect(container.querySelector('.welcome-carousel-card[data-position="active"]')).not.toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toContain('01-dashboard.webp');
    expect(cards[0].getAttribute('aria-current')).toBe('true');
  });

  it('advances by itself every few seconds', () => {
    render();
    expect(caption()).toBe(WELCOME_SLIDES[0].label);
    act(() => {
      vi.advanceTimersByTime(3700);
    });
    expect(caption()).toBe(WELCOME_SLIDES[1].label);
  });

  it('rotates when a side card is clicked', () => {
    render();
    const next = container.querySelector(
      '.welcome-carousel-card[data-position="next"]'
    ) as HTMLButtonElement;
    click(next);
    expect(caption()).toBe(WELCOME_SLIDES[1].label);
    expect(
      container.querySelector('.welcome-carousel-card[data-position="active"]')
    ).toBe(next);
  });

  it('moves with the arrow controls and wraps around', () => {
    render();
    click(button('Previous screenshot')!);
    expect(caption()).toBe(WELCOME_SLIDES[WELCOME_SLIDES.length - 1].label);
    click(button('Next screenshot')!);
    expect(caption()).toBe(WELCOME_SLIDES[0].label);
  });

  it('can be paused and resumed', () => {
    render();
    click(button('Pause the screenshot carousel')!);
    act(() => {
      vi.advanceTimersByTime(12000);
    });
    expect(caption()).toBe(WELCOME_SLIDES[0].label);

    click(button('Play the screenshot carousel')!);
    act(() => {
      vi.advanceTimersByTime(3700);
    });
    expect(caption()).toBe(WELCOME_SLIDES[1].label);
  });

  it('stays still when the visitor prefers reduced motion', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    render();
    act(() => {
      vi.advanceTimersByTime(12000);
    });
    expect(caption()).toBe(WELCOME_SLIDES[0].label);
    expect(button('Pause the screenshot carousel')).toBeUndefined();
    window.matchMedia = original;
  });

  it('gives a coarse pointer a stable resting tilt', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    render();
    const scene = container.querySelector('.welcome-carousel-scene') as HTMLElement;
    expect(scene.style.getPropertyValue('--tilt-x')).toMatch(/^-?\d+\.\d{2}deg$/);
    expect(scene.style.getPropertyValue('--tilt-y')).toMatch(/^-?\d+\.\d{2}deg$/);
    window.matchMedia = original;
  });
});
