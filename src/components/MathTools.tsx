import { MathText } from './MathText';
import { Card } from './ui';

/** Official College Board Digital SAT Desmos Graphing Calculator URL. */
export const DESMOS_CB_GRAPHING_URL = 'https://www.desmos.com/testing/collegeboard/graphing';

/**
 * Embedded official College Board Desmos Graphing Calculator used across Practice,
 * Arcade, and the Full-Screen Bluebook Adaptive Test.
 */
export function CalculatorPanel({ height = 540 }: { height?: number }) {
  return (
    <Card>
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
    </Card>
  );
}

const REFERENCE_FORMULAS = [
  { name: 'Circle area & circumference', latex: '$A = \\pi r^2,\\quad C = 2\\pi r$' },
  {
    name: 'Rectangle & triangle area',
    latex: '$A_{\\text{rect}} = \\ell w,\\quad A_{\\text{tri}} = \\tfrac{1}{2}bh$',
  },
  { name: 'Pythagorean theorem', latex: '$a^2 + b^2 = c^2$' },
  {
    name: 'Special right triangles',
    latex:
      '$30^\\circ\\text{-}60^\\circ\\text{-}90^\\circ: x,\\, x\\sqrt{3},\\, 2x \\quad | \\quad 45^\\circ\\text{-}45^\\circ\\text{-}90^\\circ: s,\\, s,\\, s\\sqrt{2}$',
  },
  {
    name: 'Rectangular prism & cylinder volume',
    latex: '$V_{\\text{box}} = \\ell w h,\\quad V_{\\text{cyl}} = \\pi r^2 h$',
  },
  {
    name: 'Sphere, cone & pyramid volume',
    latex:
      '$V_{\\text{sphere}} = \\tfrac{4}{3}\\pi r^3,\\quad V_{\\text{cone}} = \\tfrac{1}{3}\\pi r^2 h,\\quad V_{\\text{pyr}} = \\tfrac{1}{3}\\ell w h$',
  },
  {
    name: 'Angle Facts',
    latex: 'Circle $= 360^\\circ = 2\\pi$ rad; Triangle interior sum $= 180^\\circ$',
  },
];

export function MathReferenceSheet() {
  return (
    <Card>
      <h3>SAT Suite Math Reference Sheet</h3>
      <p className="muted">
        Standard geometry and measurement formulas provided during every Digital SAT and PSAT Math
        module.
      </p>
      <table>
        <thead>
          <tr>
            <th>Topic</th>
            <th>Formula / Relationship</th>
          </tr>
        </thead>
        <tbody>
          {REFERENCE_FORMULAS.map((row) => (
            <tr key={row.name}>
              <td>
                <strong>{row.name}</strong>
              </td>
              <td>
                <MathText text={row.latex} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
