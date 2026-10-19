import { useId } from 'react';
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

export interface CoordinateFigureMeta {
  type: 'coordinate_plane';
  caption?: string;
  x_label?: string;
  y_label?: string;
  x_min?: number;
  x_max?: number;
  y_min?: number;
  y_max?: number;
  lines?: {
    slope?: number;
    intercept?: number;
    label?: string;
    dashed?: boolean;
  }[];
  points?: { x: number; y: number; label?: string; open?: boolean }[];
  parabolas?: { a: number; b: number; c: number; label?: string }[];
}

export interface GeometryFigureMeta {
  type: 'geometry_figure';
  caption?: string;
  shape: 'right_triangle' | 'triangle' | 'rectangle' | 'circle';
  labels?: { a?: string; b?: string; c?: string; w?: string; h?: string; r?: string };
}

export type FigureMeta = TableFigureMeta | ChartFigureMeta | CoordinateFigureMeta | GeometryFigureMeta;

function parseFigureMeta(raw: unknown): FigureMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { type?: string };
  if (
    obj.type === 'table' ||
    obj.type === 'bar_chart' ||
    obj.type === 'line_chart' ||
    obj.type === 'coordinate_plane' ||
    obj.type === 'geometry_figure'
  ) {
    return raw as FigureMeta;
  }
  return null;
}

/** Coordinate plane drawn to scale, with grid lines, labelled axes, lines and parabolas. */
function CoordinatePlane({ meta }: { meta: CoordinateFigureMeta }) {
  const uid = useId().replace(/:/g, '');
  const width = 480;
  const height = 360;
  const pad = 34;
  const xMin = meta.x_min ?? -6;
  const xMax = meta.x_max ?? 6;
  const yMin = meta.y_min ?? -6;
  const yMax = meta.y_max ?? 6;
  const sx = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * (width - pad * 2);
  const sy = (y: number) => height - pad - ((y - yMin) / (yMax - yMin)) * (height - pad * 2);
  const xStep = xMax - xMin > 16 ? 4 : xMax - xMin > 10 ? 2 : 1;
  const yStep = yMax - yMin > 16 ? 4 : yMax - yMin > 10 ? 2 : 1;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = Math.ceil(xMin); x <= xMax; x += xStep) xs.push(x);
  for (let y = Math.ceil(yMin); y <= yMax; y += yStep) ys.push(y);

  const pathFor = (line: NonNullable<CoordinateFigureMeta['lines']>[number]) => {
    const m = line.slope ?? 0;
    const b = line.intercept ?? 0;
    return `M ${sx(xMin)} ${sy(m * xMin + b)} L ${sx(xMax)} ${sy(m * xMax + b)}`;
  };

  const parabolaPath = (p: NonNullable<CoordinateFigureMeta['parabolas']>[number]) => {
    const points: string[] = [];
    const steps = 100;
    for (let i = 0; i <= steps; i += 1) {
      const x = xMin + ((xMax - xMin) * i) / steps;
      const y = p.a * x * x + p.b * x + p.c;
      points.push(`${i === 0 ? 'M' : 'L'} ${sx(x)} ${sy(y)}`);
    }
    return points.join(' ');
  };

  const labelX = meta.x_label ?? 'x';
  const labelY = meta.y_label ?? 'y';

  return (
    <div className="figure-box" data-testid="figure-coordinate-plane">
      {meta.caption ? <div className="figure-caption">{meta.caption}</div> : null}
      <div className="figure-chart-wrap">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={meta.caption ?? 'Coordinate plane'}
          className="figure-svg"
        >
          <defs>
            <clipPath id={`coord-clip-${uid}`}>
              <rect x={pad} y={pad} width={width - pad * 2} height={height - pad * 2} />
            </clipPath>
            <marker id={`axis-arrow-${uid}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#1f2937" />
            </marker>
          </defs>

          {xs.map((x) => (
            <line
              key={`gx-${x}`}
              x1={sx(x)}
              y1={pad}
              x2={sx(x)}
              y2={height - pad}
              stroke="#e3e7ed"
              strokeWidth={1}
            />
          ))}
          {ys.map((y) => (
            <line
              key={`gy-${y}`}
              x1={pad}
              y1={sy(y)}
              x2={width - pad}
              y2={sy(y)}
              stroke="#e3e7ed"
              strokeWidth={1}
            />
          ))}

          <g clipPath={`url(#coord-clip-${uid})`}>
            {(meta.lines ?? []).map((line, i) => (
              <path
                key={`line-${i}`}
                d={pathFor(line)}
                fill="none"
                stroke={i === 0 ? '#1d4ed8' : '#b45309'}
                strokeWidth={2.4}
                strokeDasharray={line.dashed ? '6 4' : undefined}
              />
            ))}
            {(meta.parabolas ?? []).map((p, i) => (
              <path
                key={`parabola-${i}`}
                d={parabolaPath(p)}
                fill="none"
                stroke="#1d4ed8"
                strokeWidth={2.4}
              />
            ))}
          </g>

          {/* Axes */}
          <line
            x1={sx(xMin)}
            y1={sy(0)}
            x2={sx(xMax)}
            y2={sy(0)}
            stroke="#1f2937"
            strokeWidth={1.6}
            markerEnd={`url(#axis-arrow-${uid})`}
          />
          <line
            x1={sx(0)}
            y1={sy(yMin)}
            x2={sx(0)}
            y2={sy(yMax)}
            stroke="#1f2937"
            strokeWidth={1.6}
            markerEnd={`url(#axis-arrow-${uid})`}
          />

          {xs.map((x) =>
            x === 0 ? null : (
              <g key={`tx-${x}`}>
                <line x1={sx(x)} y1={sy(0) - 4} x2={sx(x)} y2={sy(0) + 4} stroke="#1f2937" strokeWidth={1.2} />
                <text x={sx(x)} y={sy(0) + 17} textAnchor="middle" fontSize="11" fill="#374151">
                  {x}
                </text>
              </g>
            )
          )}
          {ys.map((y) =>
            y === 0 ? null : (
              <g key={`ty-${y}`}>
                <line x1={sx(0) - 4} y1={sy(y)} x2={sx(0) + 4} y2={sy(y)} stroke="#1f2937" strokeWidth={1.2} />
                <text x={sx(0) - 9} y={sy(y) + 4} textAnchor="end" fontSize="11" fill="#374151">
                  {y}
                </text>
              </g>
            )
          )}

          <text x={width - pad + 2} y={sy(0) + 16} fontSize="12" fontWeight="600" fill="#1f2937">
            {labelX}
          </text>
          <text x={sx(0) + 8} y={pad - 6} fontSize="12" fontWeight="600" fill="#1f2937">
            {labelY}
          </text>

          {(meta.points ?? []).map((p, i) => (
            <g key={`pt-${i}`}>
              <circle
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={4.5}
                fill={p.open ? '#ffffff' : '#111827'}
                stroke="#111827"
                strokeWidth={1.6}
              />
              {p.label ? (
                <text x={sx(p.x) + 8} y={sy(p.y) - 8} fontSize="11" fill="#111827">
                  {p.label}
                </text>
              ) : null}
            </g>
          ))}

          {(meta.lines ?? [])[0]?.label ? (
            <text x={width - pad} y={pad + 14} textAnchor="end" fontSize="11" fill="#1d4ed8">
              {(meta.lines ?? [])[0]?.label}
            </text>
          ) : null}
        </svg>
      </div>
    </div>
  );
}

/** Labelled geometry diagram: right triangle, triangle with height, rectangle or circle. */
function GeometryFigure({ meta }: { meta: GeometryFigureMeta }) {
  const labels = meta.labels ?? {};
  const stroke = '#14181f';
  let body: React.ReactNode = null;

  if (meta.shape === 'right_triangle') {
    body = (
      <>
        <polygon points="70,220 330,220 330,70" fill="none" stroke={stroke} strokeWidth={2} />
        <polyline points="318,220 318,208 330,208" fill="none" stroke={stroke} strokeWidth={1.4} />
        {labels.a ? <text x="200" y="244" textAnchor="middle" fontSize="16">{labels.a}</text> : null}
        {labels.b ? <text x="344" y="150" fontSize="16">{labels.b}</text> : null}
        {labels.c ? <text x="186" y="138" textAnchor="middle" fontSize="16">{labels.c}</text> : null}
      </>
    );
  } else if (meta.shape === 'triangle') {
    body = (
      <>
        <polygon points="70,220 330,220 210,70" fill="none" stroke={stroke} strokeWidth={2} />
        <line x1="210" y1="70" x2="210" y2="220" stroke="#6b7280" strokeWidth={1.4} strokeDasharray="5 4" />
        <polyline points="200,220 200,210 210,210" fill="none" stroke="#6b7280" strokeWidth={1.2} />
        {labels.b ? <text x="200" y="246" textAnchor="middle" fontSize="16">{labels.b}</text> : null}
        {labels.h ? <text x="220" y="150" fontSize="16">{labels.h}</text> : null}
      </>
    );
  } else if (meta.shape === 'rectangle') {
    body = (
      <>
        <rect x="90" y="80" width="240" height="140" fill="none" stroke={stroke} strokeWidth={2} />
        {labels.w ? <text x="210" y="246" textAnchor="middle" fontSize="16">{labels.w}</text> : null}
        {labels.h ? <text x="344" y="156" fontSize="16">{labels.h}</text> : null}
      </>
    );
  } else {
    body = (
      <>
        <circle cx="210" cy="145" r="86" fill="none" stroke={stroke} strokeWidth={2} />
        <line x1="210" y1="145" x2="296" y2="145" stroke={stroke} strokeWidth={1.6} />
        <circle cx="210" cy="145" r="2.6" fill={stroke} />
        {labels.r ? <text x="248" y="138" textAnchor="middle" fontSize="16">{labels.r}</text> : null}
      </>
    );
  }

  return (
    <div className="figure-box" data-testid="figure-geometry">
      {meta.caption ? <div className="figure-caption">{meta.caption}</div> : null}
      <div className="figure-chart-wrap">
        <svg viewBox="0 0 420 270" role="img" aria-label={meta.caption ?? 'Geometry figure'} className="figure-svg">
          {body}
        </svg>
      </div>
    </div>
  );
}

/**
 * Wraps a category label onto at most `maxLines` lines of roughly `maxChars`
 * characters. SAT figures wrap axis labels rather than clipping them, so the
 * full category name always stays readable.
 */
export function wrapLabel(label: string, maxChars: number, maxLines = 3): string[] {
  const words = String(label).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
    return kept;
  }
  return lines;
}

function BarOrLineChart({ meta }: { meta: ChartFigureMeta }) {
  const series = meta.series ?? [];
  if (series.length === 0) return null;

  const width = 520;
  const padLeft = 64;
  const padRight = 22;
  const padTop = 26;
  const plotW = width - padLeft - padRight;
  const plotH = 168;
  const slotW = plotW / series.length;
  const maxChars = Math.max(9, Math.floor(slotW / 6.2));
  const labelLines = series.map((pt) => wrapLabel(pt.label, maxChars));
  const labelRowCount = Math.max(1, ...labelLines.map((lines) => lines.length));
  const padBottom = 32 + labelRowCount * 13;
  const height = padTop + plotH + padBottom;
  const labelTop = padTop + plotH + 18;

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
                    y={labelTop}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#1f2937"
                    fontFamily="sans-serif"
                  >
                    {labelLines[idx].map((line, lineIdx) => (
                      <tspan key={lineIdx} x={cx} dy={lineIdx === 0 ? 0 : 12}>
                        {line}
                      </tspan>
                    ))}
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
                      y={labelTop}
                      textAnchor="middle"
                      fontSize="11"
                      fill="#1f2937"
                      fontFamily="sans-serif"
                    >
                      {labelLines[idx].map((line, lineIdx) => (
                        <tspan key={lineIdx} x={cx} dy={lineIdx === 0 ? 0 : 12}>
                          {line}
                        </tspan>
                      ))}
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
              y={height - 8}
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

  if (meta.type === 'coordinate_plane') return <CoordinatePlane meta={meta} />;
  if (meta.type === 'geometry_figure') return <GeometryFigure meta={meta} />;
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
