import { useId, useMemo, useState } from 'react';
import {
  HEATMAP_DIFFICULTIES,
  buildMasteryRadar,
  type MasteryHeatmapDomain,
} from '../lib/masteryHeatmap';
import type { Difficulty } from '../lib/types';

/**
 * Dashboard mastery radar.
 *
 * The same eight domains and the same recorded attempts the per-skill heatmap
 * used, drawn once around a circle: the radius is accuracy, so a full octagon
 * is mastery and a pinched shape is a weak area. The difficulty control keeps
 * the Easy/Medium/Hard split the heatmap columns offered without making the
 * card tall again.
 */

const SHORT_LABELS: Record<string, string[]> = {
  'Craft and Structure': ['Craft &', 'Structure'],
  'Information and Ideas': ['Information', '& Ideas'],
  'Standard English Conventions': ['Standard', 'Conventions'],
  'Expression of Ideas': ['Expression', 'of Ideas'],
  Algebra: ['Algebra'],
  'Advanced Math': ['Advanced', 'Math'],
  'Problem-Solving and Data Analysis': ['Problem-', 'Solving'],
  'Geometry and Trigonometry': ['Geometry &', 'Trigonometry'],
};

const WIDTH = 360;
const HEIGHT = 320;
const CX = WIDTH / 2;
const CY = 158;
const RADIUS = 94;
const LABEL_RADIUS = 114;
const RINGS = [0.25, 0.5, 0.75, 1];

function pointAt(index: number, count: number, radius: number): [number, number] {
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  return [CX + Math.cos(angle) * radius, CY + Math.sin(angle) * radius];
}

function polygonAt(count: number, radius: number): string {
  return Array.from({ length: count }, (_, index) =>
    pointAt(index, count, radius)
      .map((value) => value.toFixed(1))
      .join(',')
  ).join(' ');
}

export function MasteryRadar({ domains }: { domains: MasteryHeatmapDomain[] }) {
  const [difficulty, setDifficulty] = useState<Difficulty | 'all'>('all');
  const chartId = useId().replace(/:/g, '');

  const axes = useMemo(() => buildMasteryRadar(domains, difficulty), [domains, difficulty]);
  const attempts = axes.reduce((sum, axis) => sum + axis.attempts, 0);
  const correct = axes.reduce((sum, axis) => sum + axis.correct, 0);
  const overall = attempts > 0 ? Math.round((correct / attempts) * 100) : null;

  const plotted = axes.map((axis, index) => {
    const radius = ((axis.accuracy ?? 0) / 100) * RADIUS;
    const [x, y] = pointAt(index, axes.length, radius);
    return { ...axis, x, y };
  });
  const areaPoints = plotted.map((entry) => `${entry.x.toFixed(1)},${entry.y.toFixed(1)}`).join(' ');

  const description = axes
    .map((axis) =>
      axis.accuracy === null
        ? `${axis.domain}: no attempts`
        : `${axis.domain}: ${axis.accuracy} percent from ${axis.attempts} attempts`
    )
    .join('; ');

  return (
    <div className="mastery-radar">
      <div className="seg-group radar-difficulty" role="group" aria-label="Radar difficulty">
        {(['all', ...HEATMAP_DIFFICULTIES] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`seg-btn${difficulty === value ? ' is-selected' : ''}`}
            aria-pressed={difficulty === value}
            onClick={() => setDifficulty(value)}
          >
            {value === 'all' ? 'All' : value}
          </button>
        ))}
      </div>

      <svg
        className="radar-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby={`${chartId}-title`}
        aria-describedby={`${chartId}-desc`}
      >
        <title id={`${chartId}-title`}>
          Mastery radar by domain{difficulty === 'all' ? '' : `, ${difficulty} questions`}
        </title>
        <desc id={`${chartId}-desc`}>{description}</desc>

        {RINGS.map((ring) => (
          <polygon
            key={ring}
            className={`radar-ring${ring === 1 ? ' is-outer' : ''}`}
            points={polygonAt(axes.length, RADIUS * ring)}
          />
        ))}
        {axes.map((axis, index) => {
          const [x, y] = pointAt(index, axes.length, RADIUS);
          return (
            <line
              key={axis.domain}
              className="radar-spoke"
              x1={CX}
              y1={CY}
              x2={x}
              y2={y}
            />
          );
        })}
        <text className="radar-tick" x={CX + 4} y={CY - RADIUS + 12}>
          100%
        </text>
        <text className="radar-tick" x={CX + 4} y={CY - RADIUS / 2 + 3}>
          50%
        </text>

        <polygon className="radar-area" points={areaPoints} />
        {plotted.map((entry) => (
          <circle
            key={entry.domain}
            className={`radar-point${entry.accuracy === null ? ' is-empty' : ''}`}
            cx={entry.x}
            cy={entry.y}
            r={entry.accuracy === null ? 2.5 : 3.5}
          >
            <title>
              {entry.accuracy === null
                ? `${entry.domain}: no attempts yet`
                : `${entry.domain}: ${entry.correct}/${entry.attempts} correct (${entry.accuracy}%)`}
            </title>
          </circle>
        ))}

        {axes.map((axis, index) => {
          const [x, y] = pointAt(index, axes.length, LABEL_RADIUS);
          const lines = SHORT_LABELS[axis.domain] ?? [axis.domain];
          const startY = y + 4 - ((lines.length - 1) * 11) / 2;
          const anchor = x < CX - 4 ? 'end' : x > CX + 4 ? 'start' : 'middle';
          return (
            <text
              key={axis.domain}
              className={`radar-axis-label${axis.accuracy === null ? ' is-empty' : ''}`}
              x={x}
              y={startY}
              textAnchor={anchor}
            >
              {lines.map((line, lineIndex) => (
                <tspan key={line} x={x} dy={lineIndex === 0 ? 0 : 11}>
                  {line}
                </tspan>
              ))}
            </text>
          );
        })}
      </svg>

      <p className="radar-summary">
        {attempts > 0
          ? `${overall}% accuracy · ${attempts.toLocaleString()} attempt${attempts === 1 ? '' : 's'}${
              difficulty === 'all' ? '' : ` on ${difficulty} questions`
            }`
          : `No ${difficulty === 'all' ? '' : `${difficulty.toLowerCase()} `}attempts yet — answer questions and the shape fills in.`}
      </p>

      <ul className="radar-legend">
        {axes.map((axis) => (
          <li
            key={axis.domain}
            title={
              axis.accuracy === null
                ? `${axis.domain}: no attempts yet`
                : `${axis.domain}: ${axis.correct}/${axis.attempts} correct`
            }
          >
            <span
              className={`radar-legend-dot${axis.accuracy === null ? ' is-empty' : ''}`}
              aria-hidden="true"
            />
            <span className="radar-legend-name">{axis.domain}</span>
            <span className="radar-legend-value">
              {axis.accuracy === null ? '—' : `${axis.accuracy}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
