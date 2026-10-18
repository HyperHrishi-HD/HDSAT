import { MathText } from './MathText';
import type { Question } from '../lib/types';

export interface TableFigureMeta {
  type: 'table';
  caption?: string;
  headers?: string[];
  rows?: string[][];
}

export interface ChartSeriesPoint {
  label: string;
  value: number;
}

export interface ChartFigureMeta {
  type: 'bar_chart' | 'line_chart';
  caption?: string;
  x_label?: string;
  y_label?: string;
  series?: ChartSeriesPoint[];
}

export type FigureMeta = TableFigureMeta | ChartFigureMeta;

function parseFigureMeta(raw: unknown): FigureMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { type?: string };
  if (obj.type === 'table' || obj.type === 'bar_chart' || obj.type === 'line_chart') {
    return raw as FigureMeta;
  }
  return null;
}

function BarOrLineChart({ meta }: { meta: ChartFigureMeta }) {
  const series = meta.series ?? [];
  if (series.length === 0) return null;

  const width = 520;
  const height = 270;
  const padLeft = 58;
  const padRight = 24;
  const padTop = 26;
  const padBottom = 56;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const rawMax = Math.max(...series.map((d) => Number(d.value) || 0), 1);
  // Choose a clean upper tick multiple
  const stepMagnitude = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const niceStep =
    rawMax / stepMagnitude <= 2
      ? stepMagnitude / 2
      : rawMax / stepMagnitude <= 5
      ? stepMagnitude
      : stepMagnitude * 2;
  const yMax = Math.max(niceStep, Math.ceil(rawMax / niceStep) * niceStep);
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => (yMax / tickCount) * i);

  const toY = (v: number) => padTop + plotH - (Math.max(0, v) / yMax) * plotH;
  const slotW = plotW / series.length;

  return (
    <div className="figure-box" data-testid={`figure-${meta.type}`}>
      {meta.caption ? <div className="figure-caption">{meta.caption}</div> : null}
      <div className="figure-chart-wrap">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={meta.caption ?? 'Data chart'}
          className="figure-svg"
        >
          {/* Horizontal grid lines & Y-axis ticks */}
          {ticks.map((t, i) => {
            const y = toY(t);
            const label = Number.isInteger(t) ? String(t) : t.toFixed(1);
            return (
              <g key={i}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke={i === 0 ? '#1f2937' : '#d5dae0'}
                  strokeWidth={i === 0 ? 1.5 : 1}
                  strokeDasharray={i === 0 ? undefined : '3,3'}
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="#374151"
                  fontFamily="sans-serif"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {/* Y-axis line */}
          <line
            x1={padLeft}
            y1={padTop}
            x2={padLeft}
            y2={padTop + plotH}
            stroke="#1f2937"
            strokeWidth={1.5}
          />

          {/* Y-axis title */}
          {meta.y_label ? (
            <text
              x={16}
              y={padTop + plotH / 2}
              transform={`rotate(-90 16 ${padTop + plotH / 2})`}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="#1f2937"
              fontFamily="sans-serif"
            >
              {meta.y_label}
            </text>
          ) : null}

          {/* Bars or Line */}
          {meta.type === 'bar_chart' ? (
            series.map((pt, idx) => {
              const barW = Math.min(48, slotW * 0.56);
              const cx = padLeft + slotW * idx + slotW / 2;
              const x = cx - barW / 2;
              const y = toY(pt.value);
              const h = Math.max(1, padTop + plotH - y);
              return (
                <g key={idx}>
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={h}
                    fill="#374151"
                    rx={2}
                  />
                  <text
                    x={cx}
                    y={y - 6}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="#111827"
                    fontFamily="sans-serif"
                  >
                    {pt.value}
                  </text>
                  <text
                    x={cx}
                    y={padTop + plotH + 18}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#1f2937"
                    fontFamily="sans-serif"
                  >
                    {pt.label.length > 16 ? `${pt.label.slice(0, 15)}…` : pt.label}
                  </text>
                </g>
              );
            })
          ) : (
            <>
              <polyline
                fill="none"
                stroke="#1d4ed8"
                strokeWidth={2.5}
                points={series
                  .map((pt, idx) => {
                    const cx = padLeft + slotW * idx + slotW / 2;
                    const cy = toY(pt.value);
                    return `${cx},${cy}`;
                  })
                  .join(' ')}
              />
              {series.map((pt, idx) => {
                const cx = padLeft + slotW * idx + slotW / 2;
                const cy = toY(pt.value);
                return (
                  <g key={idx}>
                    <circle cx={cx} cy={cy} r={4.5} fill="#1d4ed8" stroke="#ffffff" strokeWidth={1.5} />
                    <text
                      x={cx}
                      y={cy - 9}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="700"
                      fill="#111827"
                      fontFamily="sans-serif"
                    >
                      {pt.value}
                    </text>
                    <text
                      x={cx}
                      y={padTop + plotH + 18}
                      textAnchor="middle"
                      fontSize="11"
                      fill="#1f2937"
                      fontFamily="sans-serif"
                    >
                      {pt.label.length > 16 ? `${pt.label.slice(0, 15)}…` : pt.label}
                    </text>
                  </g>
                );
              })}
            </>
          )}

          {/* X-axis title */}
          {meta.x_label ? (
            <text
              x={padLeft + plotW / 2}
              y={height - 10}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="#1f2937"
              fontFamily="sans-serif"
            >
              {meta.x_label}
            </text>
          ) : null}
        </svg>
      </div>
    </div>
  );
}

export function FigureView({ question }: { question: Question }) {
  const meta = parseFigureMeta(question.figure_metadata);
  if (!meta) return null;

  if (meta.type === 'table') {
    return (
      <div className="figure-box" data-testid="figure-table">
        {meta.caption ? <div className="figure-caption">{meta.caption}</div> : null}
        <table className="figure-table">
          <thead>
            <tr>
              {(meta.headers ?? []).map((h, i) => (
                <th key={i}>
                  <MathText text={h} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(meta.rows ?? []).map((r, ri) => (
              <tr key={ri}>
                {r.map((cell, ci) => (
                  <td key={ci}>
                    <MathText text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return <BarOrLineChart meta={meta} />;
}

/**
 * Renders a question's stimulus text cleanly:
 * - Formats bulleted lists (`• ...` or `- ...`) as real HTML `<ul><li>` lists
 * - Renders `Text 1` / `Text 2` headers in bold for Cross-Text Connections items
 * - Renders inline/display LaTeX and blanks (`______` or `____`) cleanly
 */
export function StimulusView({ stimulus }: { stimulus: string | null }) {
  if (!stimulus || !stimulus.trim()) return null;

  const lines = stimulus.split('\n');
  const blocks: React.ReactNode[] = [];
  let currentBullets: string[] = [];

  const flushBullets = (keyPrefix: string) => {
    if (currentBullets.length === 0) return;
    blocks.push(
      <ul key={`${keyPrefix}-ul`} className="stimulus-bullets">
        {currentBullets.map((b, i) => (
          <li key={i}>
            <MathText text={b} />
          </li>
        ))}
      </ul>
    );
    currentBullets = [];
  };

  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushBullets(`line-${idx}`);
      return;
    }
    if (/^[•\-]\s+/.test(trimmed)) {
      currentBullets.push(trimmed.replace(/^[•\-]\s+/, ''));
      return;
    }
    flushBullets(`line-${idx}`);

    // Format "Text 1" / "Text 2" headers nicely
    if (/^Text\s+[12]$/i.test(trimmed)) {
      blocks.push(
        <div key={`h-${idx}`} className="stimulus-text-heading">
          <strong>{trimmed}</strong>
        </div>
      );
      return;
    }
    const inlineTextMatch = trimmed.match(/^(Text\s+[12]:)\s*(.+)$/i);
    if (inlineTextMatch) {
      blocks.push(
        <p key={`p-${idx}`} className="stimulus-paragraph">
          <strong>{inlineTextMatch[1]}</strong> <MathText text={inlineTextMatch[2]} />
        </p>
      );
      return;
    }

    blocks.push(
      <p key={`p-${idx}`} className="stimulus-paragraph">
        <MathText text={trimmed} />
      </p>
    );
  });

  flushBullets('end');

  return <div className="stimulus-rendered">{blocks}</div>;
}
