import type { ReactNode } from 'react';

/**
 * Page-shaped loading placeholders.
 *
 * These use the real app-shell, card, card-grid and grid-2 classes. That is
 * deliberate: the placeholder should inherit the same width, padding and
 * breakpoints as the page that replaces it, so nothing shifts when the bank or
 * session arrives. Only the content inside the cards is fake.
 */
export type PageSkeletonVariant =
  | 'page'
  | 'welcome'
  | 'dashboard'
  | 'practice'
  | 'bank'
  | 'flashcards'
  | 'test'
  | 'arcade'
  | 'account';

type Width = number | string;
type Height = number | string;

function Line({
  width = '100%',
  height = 10,
  title = false,
  className = '',
}: {
  width?: Width;
  height?: Height;
  title?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`sk-line${title ? ' is-title' : ''}${className ? ` ${className}` : ''}`}
      style={{ width, height: title && height === 10 ? 24 : height }}
      aria-hidden="true"
    />
  );
}

function Bar({ width = 86, height = 32 }: { width?: Width; height?: Height }) {
  return (
    <span className="sk-btn" style={{ width, height }} aria-hidden="true" />
  );
}

function Chip({ width = 72 }: { width?: Width }) {
  return <span className="sk-badge" style={{ width }} aria-hidden="true" />;
}

function Info({ width = 108 }: { width?: Width }) {
  return <span className="sk-info" style={{ width }} aria-hidden="true" />;
}

function Field({
  labelWidth = '48%',
  select = false,
}: {
  labelWidth?: Width;
  select?: boolean;
}) {
  return (
    <span className="sk-field" aria-hidden="true">
      <span className="sk-field-label">
        <Line width={labelWidth} height={9} />
      </span>
      <span className={`sk-input${select ? ' is-select' : ''}`} />
    </span>
  );
}

/** A segmented Select, which is what most of the study filters actually render. */
function SegField({
  labelWidth = '40%',
  count,
  minWidth = 70,
  tall = false,
}: {
  labelWidth?: Width;
  count: number;
  minWidth?: Width;
  tall?: boolean;
}) {
  return (
    <span className="sk-field" aria-hidden="true">
      <span className="sk-field-label">
        <Line width={labelWidth} height={9} />
      </span>
      <span className="sk-seg-group">
        {Array.from({ length: count }).map((_, index) => (
          <span
            key={index}
            className={`sk-seg-btn${tall ? ' is-tall' : ''}`}
            style={{ minWidth }}
          />
        ))}
      </span>
    </span>
  );
}

function Toggle({ width = '62%' }: { width?: Width }) {
  return (
    <span className="sk-toggle" aria-hidden="true">
      <span className="sk-check" />
      <Line width={width} height={9} />
    </span>
  );
}

function StatLines() {
  return (
    <span className="sk-stat" aria-hidden="true">
      <Line width="46%" height={8} />
      <Line width="34%" height={22} />
      <Line width="54%" height={8} />
    </span>
  );
}

function PageHeader({
  titleWidth = '34%',
  infoWidth = 108,
  badgeWidth,
  actions,
  subWidth,
}: {
  titleWidth?: Width;
  infoWidth?: Width;
  badgeWidth?: Width;
  actions?: Width[];
  subWidth?: Width;
}) {
  return (
    <section className="card">
      <div className="row-between">
        <div className="row sk-head-main">
          <Line width={titleWidth} height={30} title />
          {infoWidth ? <Info width={infoWidth} /> : null}
        </div>
        {actions?.length ? (
          <div className="row">
            {actions.map((width, index) => (
              <Bar key={index} width={width} />
            ))}
          </div>
        ) : badgeWidth ? (
          <Chip width={badgeWidth} />
        ) : null}
      </div>
      {subWidth ? <Line width={subWidth} height={10} className="sk-subline" /> : null}
    </section>
  );
}

function QuestionCard({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`question sk-question${compact ? ' is-compact' : ''}`}>
      <div className="row-between sk-qhead" aria-hidden="true">
        <div className="row">
          <Line width={78} height={10} />
          <Chip width={54} />
        </div>
        <div className="row">
          <Bar width={70} height={28} />
          <Bar width={88} height={28} />
        </div>
      </div>
      <span className="sk-stimulus" aria-hidden="true" />
      <Line width="84%" height={12} className="sk-prompt" />
      <div className="sk-choices" aria-hidden="true">
        {[0, 1, 2, 3].map((choice) => (
          <span key={choice} className="sk-choice" />
        ))}
      </div>
    </div>
  );
}

function RouteFrame({
  variant,
  label,
  children,
}: {
  variant: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`route-skeleton route-skeleton-${variant}`}
      role="status"
      aria-label={label}
      aria-busy="true"
    >
      <div className="sk-shapes" aria-hidden="true">
        {children}
      </div>
      <span className="sr-only">{label}…</span>
    </div>
  );
}

function WelcomeSkeleton() {
  return (
    <div
      className="welcome-page sk-welcome-page"
      role="status"
      aria-label="Loading homepage"
      aria-busy="true"
    >
      <div className="welcome-aurora" aria-hidden="true" />
      <header className="welcome-top" aria-hidden="true">
        <span className="welcome-brand">
          <span className="sk-brandmark" />
          <Line width={62} height={12} />
        </span>
        <Bar width={72} height={30} />
      </header>

      <main className="welcome-hero" aria-hidden="true">
        <span className="welcome-emblem sk-welcome-emblem" />
        <Line width={148} height={9} className="sk-welcome-eyebrow" />
        <Line width="90%" height="clamp(32px, 6vw, 58px)" className="sk-welcome-title" />
        <Line width="62%" height="clamp(32px, 6vw, 58px)" className="sk-welcome-title is-last" />
        <Line width="88%" height={12} className="sk-welcome-sub" />
        <Line width="66%" height={12} className="sk-welcome-sub is-last" />

        <div className="welcome-actions">
          <Bar width={144} height={46} />
          <Bar width={168} height={46} />
        </div>

        <div className="welcome-carousel sk-welcome-carousel">
          <div className="sk-carousel-stage">
            <span className="sk-carousel-card is-left" />
            <span className="sk-carousel-card is-main">
              <Line width="34%" height={9} />
              <Line width="86%" height={10} />
              <Line width="66%" height={10} />
            </span>
            <span className="sk-carousel-card is-right" />
          </div>
          <span className="sk-carousel-caption">
            <Line width={128} height={10} />
            <Line width={256} height={9} />
          </span>
        </div>

        <Line width="56%" height={12} className="sk-welcome-motto" />

        <ul className="welcome-facts sk-welcome-facts">
          {[0, 1, 2].map((fact) => (
            <li key={fact}>
              <Line width="62%" height={10} />
              <Line width="94%" height={9} />
              <Line width="78%" height={9} />
            </li>
          ))}
        </ul>
      </main>

      <footer className="welcome-foot sk-welcome-foot" aria-hidden="true">
        <Line width={48} height={8} />
        <Line width={54} height={8} />
        <Line width={62} height={8} />
        <Line width={44} height={8} />
        <Line width={96} height={8} />
      </footer>
      <span className="sr-only">Loading HDSAT…</span>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <RouteFrame variant="dashboard" label="Loading dashboard">
      <section className="card sk-dashboard-head">
        <div className="row-between">
          <div className="row">
            <Line width={158} title />
            <Info width={64} />
          </div>
          <Chip width={54} />
        </div>
        <Line width="58%" height={10} className="sk-subline" />
        <div className="row sk-button-row">
          <Bar width={174} />
          <Bar width={146} />
        </div>
        <nav className="dash-sections sk-dash-sections" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, index) => (
            <span key={index} className="sk-dash-section">
              <span className="sk-nav-icon" />
              <Line width={`${48 + (index % 3) * 12}%`} height={9} />
            </span>
          ))}
        </nav>
      </section>

      <section className="card sk-qotd-strip">
        <div className="row-between">
          <div className="row">
            <Chip width={42} />
            <Line width={132} height={9} />
            <Chip width={70} />
          </div>
          <Bar width={54} height={26} />
        </div>
      </section>

      <div className="card-grid">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className={`card sk-dashboard-stat${item === 1 ? ' is-short' : ''}`}
          >
            <StatLines />
          </div>
        ))}
      </div>

      <div className="grid-2">
        <section className="card sk-domain-card">
          <Line width={126} title />
          <div className="sk-domain-list">
            {Array.from({ length: 7 }).map((_, index) => (
              <span key={index} className="sk-domain-row">
                <span className="row-between">
                  <Line width={`${34 + (index % 3) * 9}%`} height={9} />
                  <Line width={58} height={8} />
                </span>
                <span className="sk-progress" />
              </span>
            ))}
          </div>
        </section>

        <div className="stack">
          <section className="card sk-activity-card">
            <div className="row-between">
              <Line width={128} title />
              <Chip width={72} />
            </div>
            <Line width="72%" height={9} className="sk-subline" />
            <span className="sk-chart" />
          </section>
          <section className="card sk-recent-card">
            <div className="row-between" style={{ marginBottom: 8 }}>
              <Line width={112} title />
              <Chip width={58} />
            </div>
            <div className="muted-block row-between sk-recent-row">
              <div>
                <Line width={92} height={10} />
                <Line width={58} height={8} className="sk-quest-note" />
              </div>
              <Chip width={72} />
            </div>
          </section>
          <section className="card sk-saved-card">
            <div className="row-between">
              <div>
                <Line width={118} title />
                <Line width={152} height={9} className="sk-subline" />
              </div>
              <div className="row">
                <Bar width={98} height={28} />
                <Bar width={90} height={28} />
                <Bar width={74} height={28} />
              </div>
            </div>
          </section>
        </div>
      </div>
    </RouteFrame>
  );
}

function PracticeSkeleton() {
  return (
    <RouteFrame variant="practice" label="Loading practice">
      <PageHeader
        titleWidth={250}
        infoWidth={110}
        actions={[112, 96]}
      />

      <section className="card">
        <div className="row-between">
          <Line width={168} title />
          <Chip width={96} />
        </div>
        <div className="card-grid" style={{ marginTop: 12 }}>
          <SegField labelWidth="42%" count={4} minWidth={70} />
          <SegField labelWidth="46%" count={3} minWidth={120} />
          <Field labelWidth="38%" />
          <Field labelWidth="44%" />
          <SegField labelWidth="52%" count={4} minWidth={150} tall />
          <Field labelWidth="48%" select />
        </div>
        <div className="grid-2" style={{ marginTop: 8 }}>
          <div>
            <Toggle width="58%" />
            <Toggle width="72%" />
          </div>
          <div>
            <Toggle width="54%" />
            <Toggle width="62%" />
            <Toggle width="70%" />
          </div>
        </div>
        <div className="row-between" style={{ marginTop: 14 }}>
          <Line width={154} height={9} />
          <Bar width={112} />
        </div>
      </section>
    </RouteFrame>
  );
}

function BankSkeleton() {
  return (
    <RouteFrame variant="bank" label="Loading question bank">
      <section className="card">
        <div className="row-between">
          <div className="row">
            <Line width={188} title />
            <Info width={82} />
          </div>
          <Chip width={88} />
        </div>
        <div className="card-grid" style={{ marginTop: 12 }}>
          <Field labelWidth="56%" />
          <SegField labelWidth="42%" count={5} minWidth={64} />
          <SegField labelWidth="36%" count={3} minWidth={130} />
          <Field labelWidth="30%" select />
          <SegField labelWidth="38%" count={4} minWidth={64} />
          <SegField labelWidth="48%" count={5} minWidth={200} />
          <Field labelWidth="46%" select />
        </div>
        <div className="row sk-toggle-row">
          <Toggle width={82} />
          <Toggle width={128} />
          <Toggle width={154} />
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <Line width={92} title />
          <div className="sk-catalog-scroll">
            <div className="sk-table">
              <span className="sk-table-head">
                <Line width="64%" height={8} />
                <Line width="78%" height={8} />
                <Line width="52%" height={8} />
                <Line width="66%" height={8} />
              </span>
              {Array.from({ length: 12 }).map((_, row) => (
                <span key={row} className="sk-table-row">
                  <Line width="72%" height={9} />
                  <span className="sk-table-skill">
                    <Line width="84%" height={9} />
                    <Line width="54%" height={7} />
                  </span>
                  <Chip width={38} />
                  <Chip width={46} />
                </span>
              ))}
            </div>
          </div>
          <div className="row sk-center-row">
            <Bar width={96} height={28} />
          </div>
        </section>

        <div>
          <div className="row-between sk-bank-question-head">
            <div className="row">
              <Line width={92} height={10} />
              <Chip width={62} />
            </div>
            <div className="row">
              <Bar width={82} height={28} />
              <Bar width={72} height={28} />
            </div>
          </div>
          <QuestionCard />
        </div>
      </div>
    </RouteFrame>
  );
}

function FlashcardsSkeleton() {
  return (
    <RouteFrame variant="flashcards" label="Loading flashcards">
      <section className="card">
        <div className="row-between">
          <div className="row">
            <Line width={152} title />
            <Info width={86} />
          </div>
          <div className="row">
            <Bar width={118} />
            <Bar width={136} />
          </div>
        </div>
        <Line width="56%" height={10} className="sk-subline" />

        <div className="report-cross-links sk-cross-links">
          <Line width={112} height={8} />
          <Line width={96} height={8} />
          <Line width={108} height={8} />
          <Line width={82} height={8} />
        </div>

        <div className="flashcard-toolbar">
          <SegField labelWidth="38%" count={2} minWidth={0} />
          <Bar width={76} height={30} />
        </div>

        <div className="card-grid" style={{ marginTop: 12 }}>
          {[0, 1, 2].map((item) => (
            <StatLines key={item} />
          ))}
        </div>
      </section>

      <section className="card">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div className="row">
            <Chip width={70} />
            <Chip width={62} />
            <Chip width={54} />
          </div>
          <Line width={184} height={9} />
        </div>
        <div className="flashcard sk-flashcard">
          <Line width="42%" height="clamp(20px, 3vw, 28px)" />
          <Line width="22%" height={10} />
          <Line width="48%" height={9} />
        </div>
        <div className="row-between" style={{ marginTop: 14 }}>
          <Bar width={96} />
          <Bar width={128} />
          <Bar width={82} />
        </div>
      </section>
    </RouteFrame>
  );
}

function TestSkeleton() {
  return (
    <RouteFrame variant="test" label="Loading full test">
      <section className="card">
        <div className="row-between">
          <div className="row">
            <Line width={340} title />
            <Info width={94} />
          </div>
          <Chip width={104} />
        </div>
        <Line width="68%" height={10} className="sk-subline" />
        <div className="sk-test-fields">
          <SegField labelWidth={112} count={4} minWidth={0} />
          <Toggle width={262} />
        </div>
        <div className="score-band">
          <div className="score-band-main">
            <Line width={92} height={9} />
            <Line width={84} height={22} />
          </div>
          <Line width={210} height={9} />
        </div>
        <div className="row-between" style={{ marginTop: 16 }}>
          <Line width={202} height={9} />
          <Bar width={236} />
        </div>
      </section>
    </RouteFrame>
  );
}

function ArcadeSkeleton() {
  return (
    <RouteFrame variant="arcade" label="Loading arcade">
      <section className="card">
        <div className="row-between">
          <div className="row">
            <Line width={98} title />
            <Info width={118} />
          </div>
          <div className="row">
            <Bar width={134} />
            <Bar width={122} />
            <Bar width={112} />
          </div>
        </div>
        <div className="arcade-coin-rules sk-coin-rules">
          <span className="sk-coin-rule" />
          <span className="sk-coin-rule is-wide" />
          <span className="sk-coin-rule" />
        </div>
      </section>

      <section className="card">
        <div className="row-between" style={{ marginBottom: 10 }}>
          <div className="row">
            <span className="sk-nav-icon" />
            <Line width={142} title />
          </div>
          <Chip width={104} />
        </div>
        <Line width="70%" height={9} className="sk-subline" />
        <div className="stack" style={{ marginTop: 12 }}>
          {[0, 1, 2].map((quest) => (
            <div key={quest} className="muted-block quest-row">
              <div className="quest-row-main">
                <div className="row-between">
                  <Line width="34%" height={10} />
                  <Chip width={38} />
                </div>
                <Line width="58%" height={8} className="sk-quest-note" />
                <span className="sk-progress" />
              </div>
              <Bar width={86} height={28} />
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="row-between" style={{ marginBottom: 10 }}>
          <div className="row">
            <span className="sk-nav-icon" />
            <Line width={150} title />
          </div>
          <Chip width={58} />
        </div>
        <div className="arena-games">
          {[0, 1, 2].map((game) => (
            <div key={game} className="arena-tile">
              <span className="sk-arena-icon" />
              <span className="arena-tile-body">
                <Line width="68%" height={9} />
                <Line width="94%" height={8} />
                <Line width="72%" height={8} />
              </span>
              <Chip width={42} />
            </div>
          ))}
        </div>
      </section>
    </RouteFrame>
  );
}

function AccountSkeleton() {
  return (
    <RouteFrame variant="account" label="Loading account">
      <section className="card">
        <div className="row-between">
          <Line width={92} title />
          <Chip width={58} />
        </div>
      </section>

      <section className="card">
        <div className="row-between">
          <div>
            <Line width={128} title />
            <Line width={264} height={9} className="sk-subline" />
          </div>
          <div className="row">
            <Bar width={62} height={30} />
            <Bar width={56} height={30} />
            <Bar width={62} height={30} />
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <Line width={152} title />
          <span className="muted-block sk-account-block">
            <Line width="44%" height={10} />
            <Line width="62%" height={8} />
            <Line width="52%" height={8} />
          </span>
          <Field labelWidth={132} />
          <Bar width={104} height={30} />
        </section>
        <section className="card">
          <Line width={118} title />
          <div className="sk-domain-list">
            {[0, 1, 2].map((item) => (
              <span key={item} className="sk-domain-row">
                <Line width="38%" height={9} />
                <span className="sk-progress" />
              </span>
            ))}
          </div>
          <Bar width={116} height={30} />
        </section>
      </div>
    </RouteFrame>
  );
}

function GenericSkeleton() {
  return (
    <RouteFrame variant="page" label="Loading page">
      <PageHeader titleWidth={210} infoWidth={88} badgeWidth={70} subWidth="56%" />
      <div className="card-grid">
        {[0, 1, 2].map((item) => (
          <section key={item} className="card">
            <Line width="46%" title />
            <Line width="82%" height={9} className="sk-subline" />
            <Line width="68%" height={9} />
            <Bar width={96} height={28} />
          </section>
        ))}
      </div>
      <div className="grid-2">
        <section className="card">
          <Line width="40%" title />
          {[0, 1, 2].map((row) => (
            <Line key={row} width={`${82 - row * 8}%`} height={9} />
          ))}
        </section>
        <section className="card">
          <Line width="44%" title />
          <span className="sk-chart" />
        </section>
      </div>
    </RouteFrame>
  );
}

export function PageSkeleton({ variant = 'page' }: { variant?: PageSkeletonVariant }) {
  switch (variant) {
    case 'welcome':
      return <WelcomeSkeleton />;
    case 'dashboard':
      return <DashboardSkeleton />;
    case 'practice':
      return <PracticeSkeleton />;
    case 'bank':
      return <BankSkeleton />;
    case 'flashcards':
      return <FlashcardsSkeleton />;
    case 'test':
      return <TestSkeleton />;
    case 'arcade':
      return <ArcadeSkeleton />;
    case 'account':
      return <AccountSkeleton />;
    default:
      return <GenericSkeleton />;
  }
}

/**
 * First-load shell. The welcome page has its own full-page layout; every signed
 * in route gets the same sidebar, top bar and mobile tab bar geometry as the
 * real Layout, so the page does not slide sideways when React takes over.
 */
export function AppSkeleton({ variant = 'dashboard' }: { variant?: PageSkeletonVariant }) {
  if (variant === 'welcome') return <PageSkeleton variant="welcome" />;

  return (
    <div className="app-shell sk-shell" aria-busy="true">
      <aside className="sidebar sk-sidebar" aria-hidden="true">
        <div className="brand sk-brand">
          <span className="sk-brandmark" />
          <span className="sk-brandcopy">
            <Line width={54} height={11} />
            <Line width={76} height={8} />
          </span>
        </div>
        <div className="sk-nav">
          {Array.from({ length: 8 }).map((_, index) => (
            <span key={index} className="sk-nav-row">
              <span className="sk-nav-icon" />
              <Line width={`${52 + (index % 3) * 10}%`} height={9} />
            </span>
          ))}
        </div>
      </aside>

      <div className="main">
        <header className="topbar sk-topbar">
          <div className="topbar-inner">
            <span className="topbar-brand sk-topbar-brand" aria-hidden="true">
              <span className="sk-brandmark is-small" />
            </span>
            <div className="topbar-stats sk-topbar-stats" aria-hidden="true">
              <span className="sk-pill" style={{ width: 74 }} />
              <span className="sk-pill" style={{ width: 84 }} />
              <span className="sk-pill" style={{ width: 72 }} />
            </div>
            <Bar width={82} height={34} />
          </div>
        </header>

        <main className="content">
          <PageSkeleton variant={variant} />
        </main>

        <footer className="legal-foot sk-footer" aria-hidden="true">
          <div className="legal-links">
            <Line width={58} height={8} />
            <Line width={88} height={8} />
            <Line width={84} height={8} />
            <Line width={42} height={8} />
            <Line width={70} height={8} />
          </div>
        </footer>
      </div>

    </div>
  );
}

/** Pick the silhouette that matches the route already in the address bar. */
export function skeletonVariantForPath(path: string): PageSkeletonVariant {
  const clean = path.replace(/^#/, '').split('?')[0].replace(/\/+$/, '') || '/';
  switch (clean) {
    case '/welcome':
      return 'welcome';
    case '/practice':
      return 'practice';
    case '/bank':
      return 'bank';
    case '/flashcards':
      return 'flashcards';
    case '/test':
      return 'test';
    case '/arcade':
      return 'arcade';
    case '/account':
      return 'account';
    case '/':
      return 'dashboard';
    default:
      return 'page';
  }
}
