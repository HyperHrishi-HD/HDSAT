import { MathText } from './MathText';

/** Official College Board Digital SAT Desmos Graphing Calculator URL. */
export const DESMOS_CB_GRAPHING_URL = 'https://www.desmos.com/testing/collegeboard/graphing';

/**
 * Embedded official College Board Desmos Graphing Calculator used across Practice,
 * Arcade, and the Full-Screen Bluebook Adaptive Test.
 */
export function CalculatorPanel({ height = 540 }: { height?: number }) {
  return (
    <div className="calculator-panel">
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div>
          <h3>Desmos Graphing Calculator (College Board Version)</h3>
          <p className="muted">
            Official embedded College Board SAT Suite Desmos Graphing Calculator.
          </p>
        </div>
        <a
          href={DESMOS_CB_GRAPHING_URL}
          target="_blank"
          rel="noreferrer"
          className="btn btn-outline btn-sm"
        >
          Open in new tab
        </a>
      </div>

      <div
        style={{
          width: '100%',
          height,
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid var(--line)',
          background: '#ffffff',
        }}
      >
        <iframe
          src={DESMOS_CB_GRAPHING_URL}
          title="Desmos Graphing Calculator — College Board Version"
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          allow="clipboard-write; fullscreen"
        />
      </div>
    </div>
  );
}

function Triangle30() {
  return (
    <svg className="ref-triangle" viewBox="0 0 190 120" role="img" aria-label="30-60-90 triangle">
      <polygon points="24,98 168,98 168,22" fill="none" stroke="#14181f" strokeWidth="1.6" />
      <rect x="158" y="88" width="10" height="10" fill="none" stroke="#14181f" strokeWidth="1.2" />
      <text x="14" y="64" fontSize="12" fill="#14181f">x</text>
      <text x="92" y="114" fontSize="12" fill="#14181f">x√3</text>
      <text x="100" y="52" fontSize="12" fill="#14181f">2x</text>
      <text x="150" y="40" fontSize="11" fill="#14181f">30°</text>
      <text x="34" y="93" fontSize="11" fill="#14181f">60°</text>
    </svg>
  );
}

function Triangle45() {
  return (
    <svg className="ref-triangle" viewBox="0 0 190 120" role="img" aria-label="45-45-90 triangle">
      <polygon points="24,98 148,98 148,24" fill="none" stroke="#14181f" strokeWidth="1.6" />
      <rect x="138" y="88" width="10" height="10" fill="none" stroke="#14181f" strokeWidth="1.2" />
      <text x="14" y="66" fontSize="12" fill="#14181f">s</text>
      <text x="84" y="114" fontSize="12" fill="#14181f">s</text>
      <text x="94" y="52" fontSize="12" fill="#14181f">s√2</text>
      <text x="130" y="42" fontSize="11" fill="#14181f">45°</text>
      <text x="34" y="93" fontSize="11" fill="#14181f">45°</text>
    </svg>
  );
}

/** The formulas printed on the official SAT Suite Math reference sheet. */
const REFERENCE_FORMULAS = [
  String.raw`$A=\pi r^2$`,
  String.raw`$C=2\pi r$`,
  String.raw`$A=\ell w$`,
  String.raw`$A=\tfrac{1}{2}bh$`,
  String.raw`$a^2+b^2=c^2$`,
  String.raw`$V=\ell wh$`,
  String.raw`$V=\pi r^2h$`,
  String.raw`$V=\tfrac{4}{3}\pi r^3$`,
  String.raw`$V=\tfrac{1}{3}\pi r^2h$`,
  String.raw`$V=\tfrac{1}{3}\ell wh$`,
];

/**
 * The original SAT Suite Math reference sheet, as it appears in Bluebook:
 * the ten given formulas in two columns, the two special right triangles
 * beside them, and the three closing facts underneath. Nothing was added or
 * reworded.
 */
export function MathReferenceSheet() {
  return (
    <div className="math-reference">
      <div className="math-reference-title">Reference</div>

      <div className="math-reference-body">
        <div className="math-reference-formulas">
          {REFERENCE_FORMULAS.map((formula) => (
            <div className="math-reference-item" key={formula}>
              <MathText text={formula} />
            </div>
          ))}
        </div>

        <div className="math-reference-figures">
          <div className="math-reference-figure">
            <Triangle30 />
            <div className="math-reference-caption">30°–60°–90°</div>
          </div>
          <div className="math-reference-figure">
            <Triangle45 />
            <div className="math-reference-caption">45°–45°–90°</div>
          </div>
        </div>
      </div>

      <ul className="math-reference-facts">
        <li>The number of degrees of arc in a circle is 360.</li>
        <li>
          The number of radians of arc in a circle is <MathText text={String.raw`$2\pi$`} />.
        </li>
        <li>The sum of the measures in degrees of the angles of a triangle is 180.</li>
      </ul>
    </div>
  );
}
