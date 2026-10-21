import type { ReactNode } from 'react';

/**
 * Official College Board SAT Suite Math Reference Sheet images, extracted at
 * 200 DPI from the official "Bluebook Test Directions" PDFs published at
 * satsuite.collegeboard.org/media/pdf/ (english-sat-test-directions-bb.pdf,
 * english-pn-test-directions-bb.pdf, english-psat10-test-directions-bb.pdf,
 * english-psat89-test-directions-bb.pdf). The sheet is identical across the
 * suite; one asset per test keeps each window verifiably tied to its source.
 */
const REFERENCE_SHEETS: Record<string, string> = {
  SAT: '/reference/sat-math-reference.png',
  'PSAT/NMSQT': '/reference/psat-nmsqt-math-reference.png',
  'PSAT 10': '/reference/psat-10-math-reference.png',
  'PSAT 8/9': '/reference/psat-8-9-math-reference.png',
};

function referenceSheetSrc(assessment?: string): string {
  const key = (assessment ?? 'SAT').includes('8/9')
    ? 'PSAT 8/9'
    : (assessment ?? 'SAT').includes('10')
    ? 'PSAT 10'
    : (assessment ?? 'SAT').includes('NMSQT')
    ? 'PSAT/NMSQT'
    : 'SAT';
  return REFERENCE_SHEETS[key];
}

/** Official College Board Digital SAT Desmos Graphing Calculator URL. */
export const DESMOS_CB_GRAPHING_URL = 'https://www.desmos.com/testing/collegeboard/graphing';

/**
 * Bare calculator surface for split panes: the iframe fills whatever box it is
 * given, so the pane can be resized without reloading the graph.
 */
export function DesmosFrame({
  title = 'Desmos Graphing Calculator — College Board Version',
}: {
  title?: string;
}) {
  return (
    <iframe
      src={DESMOS_CB_GRAPHING_URL}
      title={title}
      className="desmos-frame"
      allow="clipboard-write; fullscreen"
    />
  );
}

/**
 * Chrome for a tool pane inside the split workbench: a compact labelled header
 * and a body that hands its full height to the calculator.
 */
export function ToolPane({
  label,
  href,
  hrefLabel = 'Open in new tab',
  children,
}: {
  label: string;
  href?: string;
  hrefLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="pane-tool-shell">
      <div className="pane-tool-head">
        <strong>{label}</strong>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {hrefLabel}
          </a>
        ) : null}
      </div>
      <div className="pane-tool-body">{children}</div>
    </div>
  );
}

/** The Desmos calculator fitted to a split pane, with its own header. */
export function DesmosPane() {
  return (
    <ToolPane label="Desmos Graphing Calculator" href={DESMOS_CB_GRAPHING_URL}>
      <DesmosFrame />
    </ToolPane>
  );
}

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
        <DesmosFrame />
      </div>
    </div>
  );
}

/** The formulas printed on the official SAT Suite Math reference sheet. */
export const REFERENCE_FORMULAS = [
  String.raw`$A=\pi r^2$`,
  String.raw`$C=2\pi r$`,
  String.raw`$A=\ell w$`,
  String.raw`$A=\tfrac{1}{2}bh$`,
  String.raw`$c^2=a^2+b^2$`,
  String.raw`$V=\ell wh$`,
  String.raw`$V=\pi r^2h$`,
  String.raw`$V=\tfrac{4}{3}\pi r^3$`,
  String.raw`$V=\tfrac{1}{3}\pi r^2h$`,
  String.raw`$V=\tfrac{1}{3}\ell wh$`,
];

/**
 * The official College Board SAT Suite Math Reference Sheet, exactly as it
 * appears in Bluebook for each assessment: 11 labelled geometry diagrams,
 * the 10 formulas, the Special Right Triangles panel, and the three closing
 * facts. Rendered from the official College Board test-directions PDFs.
 */
export function MathReferenceSheet({ assessment }: { assessment?: string } = {}) {
  const src = referenceSheetSrc(assessment);
  return (
    <div className="math-reference" data-testid="math-reference-sheet">
      <img
        className="math-reference-img"
        src={src}
        alt="Official College Board SAT Suite Math Reference Sheet: rectangle and rectangular prism (A = lw, V = lwh), triangle (A = 1/2 bh), circle (A = pi r squared, C = 2 pi r), right triangle (c squared = a squared + b squared), Special Right Triangles 30-60-90 and 45-45-90, cylinder (V = pi r squared h), sphere (V = 4/3 pi r cubed), cone (V = 1/3 pi r squared h), rectangular pyramid (V = 1/3 lwh), and the facts about degrees of arc, radians, and the sum of triangle angles"
        draggable={false}
      />
      {assessment ? (
        <div className="math-reference-suite-note">
          Official {assessment} Math Reference Sheet (identical across SAT, PSAT/NMSQT,
          PSAT 10, and PSAT 8/9)
        </div>
      ) : null}
    </div>
  );
}
