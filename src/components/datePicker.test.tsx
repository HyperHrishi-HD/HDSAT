// @vitest-environment jsdom
/**
 * The test-date picker replaced `<input type="date">`. Two behaviours matter:
 * picking a day commits and closes the panel, and the panel never re-opens
 * itself — which is exactly what a `<label>` wrapper used to cause, because a
 * label forwards every click inside it to its first button.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatePicker, formatTestDate } from './DatePicker';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function click(el: Element | null) {
  if (!el) throw new Error('missing element');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('test-date picker', () => {
  it('formats an ISO date without shifting the day', () => {
    expect(formatTestDate('2027-03-14')).toBe('March 14, 2027');
    expect(formatTestDate('')).toBeNull();
    expect(formatTestDate('not-a-date')).toBeNull();
  });

  it('shows the placeholder until a date is chosen', () => {
    act(() => {
      root.render(<DatePicker value={null} onChange={() => {}} placeholder="Pick your test day" />);
    });
    expect(container.querySelector('.dp-trigger')?.textContent).toContain('Pick your test day');
    expect(container.querySelector('.dp-panel')).toBeNull();
  });

  it('commits a day and closes, even inside a label wrapper', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <label>
          <DatePicker value={null} onChange={onChange} min="2020-01-01" max="2035-12-31" />
        </label>
      );
    });
    click(container.querySelector('.dp-trigger'));
    expect(container.querySelector('.dp-panel')).not.toBeNull();

    click(container.querySelector('.dp-day'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(container.querySelector('.dp-panel')).toBeNull();
  });

  it('clears the date', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <DatePicker value="2027-03-14" onChange={onChange} min="2020-01-01" max="2035-12-31" />
      );
    });
    click(container.querySelector('.dp-trigger'));
    click(container.querySelector('.dp-link'));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(container.querySelector('.dp-panel')).toBeNull();
  });

  it('opens on the selected month', () => {
    act(() => {
      root.render(
        <DatePicker value="2028-07-09" onChange={() => {}} min="2020-01-01" max="2035-12-31" />
      );
    });
    click(container.querySelector('.dp-trigger'));
    const month = container.querySelector<HTMLSelectElement>('.dp-select');
    const year = container.querySelector<HTMLSelectElement>('.dp-select-year');
    expect(month?.value).toBe('6');
    expect(year?.value).toBe('2028');
    expect(
      container.querySelector('.dp-day.is-selected')?.getAttribute('aria-label')
    ).toBe('July 9, 2028');
  });
});
