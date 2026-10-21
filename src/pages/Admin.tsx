import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Icon, type IconName } from '../components/ui';

type SectionId = 'overview' | 'reports' | 'appeals' | 'students' | 'content';

const SECTIONS: { id: SectionId; label: string; icon: IconName; count?: number }[] = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'reports', label: 'Question reports', icon: 'flag', count: 24 },
  { id: 'appeals', label: 'Appeals & safety', icon: 'shield', count: 6 },
  { id: 'students', label: 'Students', icon: 'users' },
  { id: 'content', label: 'Content health', icon: 'layers' },
];

/** Placeholder rows. The console is a layout only — nothing here is wired up. */
const REPORTS = [
  {
    id: 'QR-1041',
    question: 'M-ALG-018',
    reason: 'Marked answer looks wrong',
    from: 'guest · this device',
    age: '12 min',
    status: 'New' as const,
  },
  {
    id: 'QR-1040',
    question: 'RW-INF-032',
    reason: 'Figure does not render',
    from: 'student@example.com',
    age: '48 min',
    status: 'New' as const,
  },
  {
    id: 'QR-1039',
    question: 'M-GEO-007',
    reason: 'Skill or difficulty mistagged',
    from: 'guest · this device',
    age: '2 h',
    status: 'Triaged' as const,
  },
  {
    id: 'QR-1038',
    question: 'M-ADV-064',
    reason: 'Explanation is wrong',
    from: 'student@example.com',
    age: '3 h',
    status: 'Triaged' as const,
  },
  {
    id: 'QR-1037',
    question: 'RW-CRF-011',
    reason: 'Copyright or attribution',
    from: 'student@example.com',
    age: '1 d',
    status: 'Escalated' as const,
  },
  {
    id: 'QR-1036',
    question: 'M-PSD-092',
    reason: 'Formatting or math rendering',
    from: 'guest · this device',
    age: '1 d',
    status: 'Resolved' as const,
  },
];

const APPEALS = [
  {
    id: 'AP-318',
    category: 'Safety or abuse report',
    subject: 'Reported display name',
    age: '35 min',
    sla: 'Within SLA' as const,
  },
  {
    id: 'AP-317',
    category: 'Copyright / removal request',
    subject: 'Attribution on RW-CRF-011',
    age: '4 h',
    sla: 'Within SLA' as const,
  },
  {
    id: 'AP-316',
    category: 'Data deletion request',
    subject: 'Account erasure',
    age: '19 h',
    sla: 'Respond today' as const,
  },
  {
    id: 'AP-315',
    category: 'Account access or ban appeal',
    subject: 'Sign-in after email change',
    age: '2 d',
    sla: 'Overdue' as const,
  },
];

const STUDENTS = [
  { name: 'Hrishi', mode: 'Cloud', streak: 12, last: 'today', status: 'Active' as const },
  { name: 'Priya S.', mode: 'Cloud', streak: 4, last: 'today', status: 'Active' as const },
  { name: 'dev-test-01', mode: 'Cloud', streak: 0, last: '3 days ago', status: 'Unconfirmed' as const },
  { name: 'guest · this device', mode: 'Local', streak: 2, last: 'today', status: 'Guest' as const },
];

const CHECKS = [
  { label: 'Answer keys verified by independent solve', value: '6,193 / 6,193', tone: 'good' as const },
  { label: 'Figures generated from the key data', value: '1,204 / 1,204', tone: 'good' as const },
  { label: 'Items with an open report', value: '5', tone: 'warn' as const },
  { label: 'Reference-sheet assets present', value: '4 / 4', tone: 'good' as const },
  { label: 'Duplicate stems inside one module', value: '0', tone: 'good' as const },
];

const statusTone = (status: string) => {
  if (status === 'New') return 'info';
  if (status === 'Escalated' || status === 'Overdue') return 'bad';
  if (status === 'Respond today') return 'warn';
  if (status === 'Resolved' || status === 'Active' || status === 'Within SLA') return 'good';
  return 'neutral';
};

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'warn' | 'bad';
}) {
  return (
    <div className="adm-metric">
      <span className="adm-metric-label">{label}</span>
      <span className={`adm-metric-value${tone ? ` is-${tone}` : ''}`}>{value}</span>
      <span className="adm-metric-hint">{hint}</span>
    </div>
  );
}

function SectionHead({
  title,
  blurb,
  action,
}: {
  title: string;
  blurb: string;
  action?: string;
}) {
  return (
    <div className="adm-section-head">
      <div>
        <h1>{title}</h1>
        <p>{blurb}</p>
      </div>
      {action ? (
        <button type="button" className="adm-btn" disabled title="Not wired up yet">
          {action}
        </button>
      ) : null}
    </div>
  );
}

export function AdminPage() {
  const [section, setSection] = useState<SectionId>('overview');
  const navigate = useNavigate();

  // The console is reached at the plain /admin path, so leaving it has to drop
  // that path as well as the hash route.
  const backToApp = () => {
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/');
    }
    navigate('/');
  };

  return (
    <div className="adm-shell">
      <header className="adm-top">
        <div className="adm-top-left">
          <span className="adm-mark" aria-hidden="true">
            H
          </span>
          <div className="adm-top-title">
            <strong>HDSAT Operator</strong>
            <span>Review console</span>
          </div>
        </div>

        <div className="adm-top-right">
          <span className="adm-preview-tag">Layout preview</span>
          <button type="button" className="adm-back" onClick={backToApp}>
            <Icon name="arrow-left" size={14} />
            <span>Back to app</span>
          </button>
        </div>
      </header>

      <div className="adm-body">
        <nav className="adm-rail" aria-label="Admin sections">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`adm-nav${section === item.id ? ' is-active' : ''}`}
              onClick={() => setSection(item.id)}
            >
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
              {item.count ? <em>{item.count}</em> : null}
            </button>
          ))}

          <div className="adm-rail-foot">
            <span className="adm-rail-note">
              No sign-in, actions or data yet — this is the shell for tomorrow&apos;s work.
            </span>
          </div>
        </nav>

        <main className="adm-main">
          {section === 'overview' ? (
            <>
              <SectionHead
                title="Overview"
                blurb="Everything waiting on a human: content reports, safety appeals and catalog health."
              />

              <div className="adm-metrics">
                <Metric label="Open reports" value="24" hint="5 untouched for over a day" tone="warn" />
                <Metric label="Appeals awaiting reply" value="6" hint="1 past the 72-hour window" tone="bad" />
                <Metric label="First response (median)" value="3 h 12 m" hint="Target is under 24 h" />
                <Metric label="Items flagged as wrong" value="5" hint="Out of 6,193 in the bank" />
              </div>

              <div className="adm-columns">
                <section className="adm-card">
                  <div className="adm-card-head">
                    <h2>Triage queue</h2>
                    <span className="adm-dim">Newest first</span>
                  </div>
                  <ul className="adm-queue">
                    {REPORTS.slice(0, 4).map((row) => (
                      <li key={row.id}>
                        <span className="adm-queue-dot" aria-hidden="true" />
                        <div>
                          <strong>{row.reason}</strong>
                          <span className="adm-dim">
                            {row.id} · <span className="mono">{row.question}</span> · {row.age} ago
                          </span>
                        </div>
                        <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="adm-card">
                  <div className="adm-card-head">
                    <h2>Catalog health</h2>
                    <span className="adm-dim">bank 2026.10.18</span>
                  </div>
                  <ul className="adm-checks">
                    {CHECKS.map((check) => (
                      <li key={check.label}>
                        <span>{check.label}</span>
                        <Badge tone={check.tone}>{check.value}</Badge>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              <section className="adm-card">
                <div className="adm-card-head">
                  <h2>Recent activity</h2>
                  <span className="adm-dim">Sample data</span>
                </div>
                <ul className="adm-timeline">
                  <li>
                    <span className="adm-time">09:14</span>
                    <span>AP-318 · safety report opened by a signed-in student</span>
                  </li>
                  <li>
                    <span className="adm-time">08:52</span>
                    <span>QR-1041 · new answer-key report on M-ALG-018</span>
                  </li>
                  <li>
                    <span className="adm-time">08:31</span>
                    <span>Bank validator finished — 6,193 items, no schema drift</span>
                  </li>
                  <li>
                    <span className="adm-time">07:58</span>
                    <span>Deploy completed · bundle verified on production</span>
                  </li>
                </ul>
              </section>
            </>
          ) : null}

          {section === 'reports' ? (
            <>
              <SectionHead
                title="Question reports"
                blurb="Student-submitted content problems. Reviewing one never changes the item for anyone else."
                action="Export CSV"
              />

              <div className="adm-filters">
                <span className="adm-filter">All reasons</span>
                <span className="adm-filter">Any status</span>
                <span className="adm-filter">Any assessment</span>
                <span className="adm-filter adm-filter-input">Search question ID or text</span>
              </div>

              <section className="adm-card adm-card-flush">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Report</th>
                      <th>Question</th>
                      <th>Reason</th>
                      <th>Reporter</th>
                      <th>Age</th>
                      <th>Status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {REPORTS.map((row) => (
                      <tr key={row.id}>
                        <td className="mono">{row.id}</td>
                        <td className="mono">{row.question}</td>
                        <td>{row.reason}</td>
                        <td className="adm-dim">{row.from}</td>
                        <td className="adm-dim">{row.age}</td>
                        <td>
                          <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                        </td>
                        <td>
                          <button type="button" className="adm-row-action" disabled>
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="adm-card-foot">
                  <span className="adm-dim">Showing 6 of 24 reports</span>
                  <div className="adm-pager">
                    <button type="button" disabled>
                      Previous
                    </button>
                    <span>1 / 4</span>
                    <button type="button" disabled>
                      Next
                    </button>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {section === 'appeals' ? (
            <>
              <SectionHead
                title="Appeals & safety"
                blurb="Copyright, access, data and safety requests. The published first-response target is 72 hours."
                action="New appeal"
              />

              <div className="adm-metrics">
                <Metric label="Open" value="6" hint="Across 4 categories" />
                <Metric label="Approaching SLA" value="2" hint="Under 12 hours left" tone="warn" />
                <Metric label="Past SLA" value="1" hint="Needs a reply today" tone="bad" />
              </div>

              <section className="adm-card adm-card-flush">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Category</th>
                      <th>Subject</th>
                      <th>Age</th>
                      <th>SLA</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {APPEALS.map((row) => (
                      <tr key={row.id}>
                        <td className="mono">{row.id}</td>
                        <td>{row.category}</td>
                        <td className="adm-dim">{row.subject}</td>
                        <td className="adm-dim">{row.age}</td>
                        <td>
                          <Badge tone={statusTone(row.sla)}>{row.sla}</Badge>
                        </td>
                        <td>
                          <button type="button" className="adm-row-action" disabled>
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="adm-card">
                <div className="adm-card-head">
                  <h2>Reply composer</h2>
                  <span className="adm-dim">Disabled in this preview</span>
                </div>
                <div className="adm-composer">
                  <div className="adm-composer-to">
                    <span className="adm-dim">To</span>
                    <span className="adm-chip">Appeal AP-318 · guest this device</span>
                  </div>
                  <div className="adm-composer-lines">
                    <span />
                    <span />
                    <span className="is-short" />
                  </div>
                  <div className="adm-composer-foot">
                    <button type="button" className="adm-btn" disabled>
                      Send reply
                    </button>
                    <button type="button" className="adm-btn adm-btn-ghost" disabled>
                      Internal note
                    </button>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {section === 'students' ? (
            <>
              <SectionHead
                title="Students"
                blurb="Accounts and guest devices that have practised here. Nothing is editable yet."
              />

              <div className="adm-filters">
                <span className="adm-filter">All accounts</span>
                <span className="adm-filter">Active this week</span>
                <span className="adm-filter adm-filter-input">Search name or email</span>
              </div>

              <section className="adm-card adm-card-flush">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Mode</th>
                      <th>Streak</th>
                      <th>Last active</th>
                      <th>Status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {STUDENTS.map((row) => (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td className="adm-dim">{row.mode}</td>
                        <td>{row.streak > 0 ? `${row.streak} days` : '—'}</td>
                        <td className="adm-dim">{row.last}</td>
                        <td>
                          <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                        </td>
                        <td>
                          <button type="button" className="adm-row-action" disabled>
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="adm-card-foot">
                  <span className="adm-dim">Sample rows — real accounts load here later</span>
                </div>
              </section>
            </>
          ) : null}

          {section === 'content' ? (
            <>
              <SectionHead
                title="Content health"
                blurb="Validators that run over the question bank, decks and reference assets."
                action="Re-run checks"
              />

              <div className="adm-columns">
                <section className="adm-card">
                  <div className="adm-card-head">
                    <h2>Bank summary</h2>
                  </div>
                  <ul className="adm-checks">
                    <li>
                      <span>Questions</span>
                      <strong>6,193</strong>
                    </li>
                    <li>
                      <span>Reading &amp; Writing</span>
                      <strong>339</strong>
                    </li>
                    <li>
                      <span>Math</span>
                      <strong>4,636 + simulated forms</strong>
                    </li>
                    <li>
                      <span>Flashcards</span>
                      <strong>1,764</strong>
                    </li>
                    <li>
                      <span>Resources</span>
                      <strong>18</strong>
                    </li>
                  </ul>
                </section>

                <section className="adm-card">
                  <div className="adm-card-head">
                    <h2>Integrity checks</h2>
                  </div>
                  <ul className="adm-checks">
                    {CHECKS.map((check) => (
                      <li key={check.label}>
                        <span>{check.label}</span>
                        <Badge tone={check.tone}>{check.value}</Badge>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
