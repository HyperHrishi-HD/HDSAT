import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui';

/**
 * A calendar dropdown for the test date, in the same visual language as the
 * rest of the app.
 *
 * The native `<input type="date">` renders the browser's own chrome — a
 * different control in every browser, and on Windows a small black-and-white
 * popup that ignores the app's palette entirely. This is a plain button that
 * opens a panel, so the field matches every other setting on the page.
 *
 * Dates are handled as `YYYY-MM-DD` strings end to end. Constructing a `Date`
 * from the string (or from `toISOString()`) would shift the day in any time
 * zone behind UTC, so the calendar only ever does arithmetic on local dates.
 */

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function parseIso(value: string | null | undefined): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function formatTestDate(value: string | null | undefined): string | null {
  const parsed = parseIso(value);
  if (!parsed) return null;
  return `${MONTHS[parsed.month]} ${parsed.day}, ${parsed.year}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function weekdayOf(year: number, month: number, day: number): number {
  return new Date(year, month, day).getDay();
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Select a date',
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  min?: string;
  max?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const selected = parseIso(value);
  const today = useMemo(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  }, []);
  const bounds = useMemo(() => {
    const lower = parseIso(min) ?? { year: 1970, month: 0, day: 1 };
    const upper = parseIso(max) ?? { year: 2100, month: 11, day: 31 };
    return { lower, upper };
  }, [min, max]);

  const [view, setView] = useState(() => ({
    year: selected?.year ?? today.year,
    month: selected?.month ?? today.month,
  }));

  // Re-anchor the visible month whenever the panel opens or the value changes
  // elsewhere, so the selected day is always on screen.
  useEffect(() => {
    if (!open) return;
    const anchor = selected ?? today;
    setView({ year: anchor.year, month: anchor.month });
  }, [open, selected?.year, selected?.month, today]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const years = useMemo(() => {
    const first = bounds.lower.year;
    const last = bounds.upper.year;
    const out: number[] = [];
    for (let year = first; year <= last; year += 1) out.push(year);
    return out;
  }, [bounds]);

  const shiftMonth = (delta: number) => {
    setView((prev) => {
      const next = new Date(prev.year, prev.month + delta, 1);
      const year = Math.min(bounds.upper.year, Math.max(bounds.lower.year, next.getFullYear()));
      return { year, month: next.getMonth() };
    });
  };

  const isOutOfRange = (year: number, month: number, day: number) => {
    const key = toIso(year, month, day);
    return key < toIso(bounds.lower.year, bounds.lower.month, bounds.lower.day) ||
      key > toIso(bounds.upper.year, bounds.upper.month, bounds.upper.day);
  };

  const total = daysInMonth(view.year, view.month);
  const leading = weekdayOf(view.year, view.month, 1);
  const cells: (number | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: total }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const label = formatTestDate(value);

  return (
    <div className="dp" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`dp-trigger${open ? ' is-open' : ''}${label ? '' : ' is-empty'}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Icon name="calendar-check" size={15} />
        <span className="dp-value">{label ?? placeholder}</span>
        <span className="dp-caret" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open ? (
        <div className="dp-panel" role="dialog" aria-label="Choose your test date">
          <div className="dp-head">
            <button
              type="button"
              className="dp-nav"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
            >
              ‹
            </button>
            <div className="dp-selects">
              <select
                className="dp-select"
                aria-label="Month"
                value={view.month}
                onChange={(event) => setView((prev) => ({ ...prev, month: Number(event.target.value) }))}
              >
                {MONTHS.map((month, index) => (
                  <option key={month} value={index}>
                    {month}
                  </option>
                ))}
              </select>
              <select
                className="dp-select dp-select-year"
                aria-label="Year"
                value={view.year}
                onChange={(event) => setView((prev) => ({ ...prev, year: Number(event.target.value) }))}
              >
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="dp-nav"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
            >
              ›
            </button>
          </div>

          <div className="dp-grid dp-weekdays" aria-hidden="true">
            {WEEKDAYS.map((day, index) => (
              <span key={`${day}-${index}`} className="dp-weekday">
                {day}
              </span>
            ))}
          </div>

          <div className="dp-grid" role="grid">
            {cells.map((day, index) => {
              if (day === null) return <span key={`blank-${index}`} className="dp-blank" />;
              const iso = toIso(view.year, view.month, day);
              const isSelected = selected !== null && toIso(selected.year, selected.month, selected.day) === iso;
              const isToday =
                today.year === view.year && today.month === view.month && today.day === day;
              const disabled = isOutOfRange(view.year, view.month, day);
              return (
                <button
                  key={iso}
                  type="button"
                  className={`dp-day${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
                  disabled={disabled}
                  aria-pressed={isSelected}
                  aria-label={`${MONTHS[view.month]} ${day}, ${view.year}`}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="dp-foot">
            <button
              type="button"
              className="dp-link"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Clear
            </button>
            <span className="dp-hint">Dates shown as month, day, year</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
