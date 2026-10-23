import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Icon, type IconName } from '../components/ui';
import * as cloud from '../lib/cloud';
import { useApp } from '../lib/store';

type SectionId = 'overview' | 'reports' | 'appeals' | 'students' | 'content';

const SECTIONS: { id: SectionId; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'reports', label: 'Question reports', icon: 'flag' },
  { id: 'appeals', label: 'Appeals & safety', icon: 'shield' },
  { id: 'students', label: 'Students', icon: 'users' },
  { id: 'content', label: 'Content health', icon: 'layers' },
];

const REPORT_STATUSES = ['received', 'in_review', 'resolved', 'dismissed'];
const APPEAL_STATUSES = ['received', 'in_review', 'resolved', 'rejected'];

function relativeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months} mo` : `${Math.floor(months / 12)} y`;
}

function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

function reasonLabel(reason: string): string {
  const text = reason.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function reporterLabel(row: {
  reporter_name: string | null;
  reporter_email: string | null;
  contact_email: string | null;
}): string {
  return row.reporter_email ?? row.reporter_name ?? row.contact_email ?? 'guest';
}

const statusTone = (status: string) => {
  if (status === 'received') return 'info';
  if (status === 'in_review') return 'warn';
  if (status === 'resolved') return 'good';
  if (status === 'rejected') return 'bad';
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
  onAction,
  actionDisabled,
}: {
  title: string;
  blurb: string;
  action?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
}) {
  return (
    <div className="adm-section-head">
      <div>
        <h1>{title}</h1>
        <p>{blurb}</p>
      </div>
      {action ? (
        <button
          type="button"
          className="adm-btn"
          onClick={onAction}
          disabled={actionDisabled}
        >
          {action}
        </button>
      ) : null}
    </div>
  );
}

type AccessState = 'checking' | 'ok' | 'locked' | 'signed-out' | 'unconfigured' | 'error';

/** Where the short-lived console token lives. Cleared on lock, tab close and passcode change. */
const ADMIN_TOKEN_KEY = 'hdsat.admin.token';

export function AdminPage() {
  const app = useApp();
  const navigate = useNavigate();

  const [section, setSection] = useState<SectionId>('overview');
  const [access, setAccess] = useState<AccessState>('checking');
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState(0);
  const [adminToken, setAdminToken] = useState('');
  const [gateQuestion, setGateQuestion] = useState<{ id: string; question: string } | null>(null);
  const [gatePasscode, setGatePasscode] = useState('');
  const [gateCaptcha, setGateCaptcha] = useState('');
  const [gateMessage, setGateMessage] = useState<string | null>(null);
  const [gateBusy, setGateBusy] = useState(false);

  const [reports, setReports] = useState<cloud.AdminPage<cloud.AdminReportRow> | null>(null);
  const [appeals, setAppeals] = useState<cloud.AdminPage<cloud.AdminAppealRow> | null>(null);
  const [students, setStudents] = useState<cloud.AdminPage<cloud.AdminStudentRow> | null>(null);
  const [reasonOptions, setReasonOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{
    prompt: string;
    run: () => Promise<void>;
  } | null>(null);

  const [replyTarget, setReplyTarget] = useState<{
    kind: 'report' | 'appeal';
    id: string;
    chip: string;
    contact: string | null;
  } | null>(null);
  const [replyTitle, setReplyTitle] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [replyResult, setReplyResult] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = () => setReloadToken((token) => token + 1);

  // Access gate: a signed-in session, the operator passcode and a single-use
  // captcha. The passcode is only ever compared inside Postgres against a bcrypt
  // hash; this browser keeps a short-lived random token instead of the secret.
  useEffect(() => {
    let cancelled = false;
    if (!app.cloudConfigured) {
      setAccess('unconfigured');
      return;
    }
    if (!app.user) {
      setAccess('signed-out');
      return;
    }
    const stored =
      typeof window !== 'undefined' ? window.sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? '' : '';
    if (!stored) {
      setAccess('locked');
      return;
    }
    setAccess('checking');
    setAccessError(null);
    cloud
      .adminSessionValid(stored)
      .then((ok) => {
        if (cancelled) return;
        if (ok) {
          setAdminToken(stored);
          setAccess('ok');
          return;
        }
        window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        setAdminToken('');
        setAccess('locked');
      })
      .catch((err) => {
        if (cancelled) return;
        setAccess('error');
        setAccessError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [app.cloudConfigured, app.user, accessToken]);

  // A fresh single-use captcha whenever the gate is shown or retried.
  useEffect(() => {
    if (access !== 'locked') return;
    let cancelled = false;
    setGateQuestion(null);
    cloud
      .adminCaptchaChallenge()
      .then((challenge) => {
        if (!cancelled) setGateQuestion(challenge);
      })
      .catch((err) => {
        if (!cancelled) setGateMessage((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [access, accessToken]);

  useEffect(() => {
    setSelected(new Set());
    setActionMessage(null);
    // A composer opened for one section must not float over the next one.
    setReplyTarget(null);
    setReplyTitle('');
    setReplyBody('');
    setReplyResult(null);
  }, [section, statusFilter, reasonFilter]);

  useEffect(() => {
    if (access !== 'ok') return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        if (section === 'overview') {
          const [reportPage, appealPage] = await Promise.all([
            cloud.adminListReports(adminToken, { limit: 20 }),
            cloud.adminListAppeals(adminToken, { limit: 20 }),
          ]);
          if (cancelled) return;
          setReports(reportPage);
          setAppeals(appealPage);
          setReasonOptions((prev) =>
            Array.from(new Set([...prev, ...reportPage.items.map((item) => item.reason)]))
          );
        } else if (section === 'reports') {
          const page = await cloud.adminListReports(adminToken, {
            status: statusFilter || null,
            reason: reasonFilter || null,
            limit: 100,
          });
          if (cancelled) return;
          setReports(page);
          setReasonOptions((prev) =>
            Array.from(new Set([...prev, ...page.items.map((item) => item.reason)]))
          );
        } else if (section === 'appeals') {
          const page = await cloud.adminListAppeals(adminToken, {
            status: statusFilter || null,
            limit: 100,
          });
          if (cancelled) return;
          setAppeals(page);
        } else if (section === 'students') {
          const page = await cloud.adminListStudents(adminToken, { limit: 100 });
          if (cancelled) return;
          setStudents(page);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [access, section, statusFilter, reasonFilter, reloadToken]);

  const reportItems = reports?.items ?? [];
  const appealItems = appeals?.items ?? [];
  const openReports = reports?.open ?? reports?.total ?? 0;
  const openAppeals = appeals?.open ?? appeals?.total ?? 0;

  const visibleIds = useMemo(
    () =>
      section === 'reports'
        ? reportItems.map((row) => row.id)
        : section === 'appeals'
          ? appealItems.map((row) => row.id)
          : [],
    [section, reportItems, appealItems]
  );
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => (allVisibleSelected ? new Set() : new Set([...prev, ...visibleIds])));
  };

  const runAction = async (label: string | null, action: () => Promise<void>) => {
    setBusy(true);
    setActionMessage(null);
    try {
      await action();
      if (label) setActionMessage(label);
      reload();
    } catch (err) {
      setActionMessage(`Failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setPendingConfirm(null);
    }
  };

  const setStatusForSelected = (status: string) =>
    runAction(`Marked ${selected.size} item(s) ${status}.`, async () => {
      const ids = [...selected];
      for (const id of ids) {
        if (section === 'reports') await cloud.adminSetReportStatus(adminToken, id, status);
        else if (section === 'appeals') await cloud.adminSetAppealStatus(adminToken, id, status);
      }
      setSelected(new Set());
    });

  const deleteSelected = () =>
    setPendingConfirm({
      prompt: `Delete ${selected.size} ${section === 'reports' ? 'report' : 'appeal'}${
        selected.size === 1 ? '' : 's'
      }? This cannot be undone.`,
      run: async () => {
        const ids = [...selected];
        const deleted =
          section === 'reports'
            ? await cloud.adminBatchDeleteReports(adminToken, { ids })
            : await cloud.adminBatchDeleteAppeals(adminToken, { ids });
        setSelected(new Set());
        setActionMessage(`Deleted ${deleted} ${section === 'reports' ? 'report' : 'appeal'}(s).`);
      },
    });

  const cleanupResolved = () =>
    setPendingConfirm({
      prompt: 'Delete every resolved report older than 7 days? This cannot be undone.',
      run: async () => {
        const deleted = await cloud.adminBatchDeleteReports(adminToken, {
          status: 'resolved',
          olderThanDays: 7,
        });
        setActionMessage(`Deleted ${deleted} old resolved report(s).`);
      },
    });

  const deleteStudentReports = (row: cloud.AdminStudentRow) =>
    setPendingConfirm({
      prompt: `Delete every question report from ${
        row.email ?? row.display_name ?? 'this student'
      }?`,
      run: async () => {
        const deleted = await cloud.adminBatchDeleteReports(adminToken, { userId: row.user_id });
        setActionMessage(`Deleted ${deleted} report(s) from that student.`);
      },
    });

  const deleteStudentAppeals = (row: cloud.AdminStudentRow) =>
    setPendingConfirm({
      prompt: `Delete every appeal from ${
        row.email ?? row.display_name ?? 'this student'
      }?`,
      run: async () => {
        const deleted = await cloud.adminBatchDeleteAppeals(adminToken, { userId: row.user_id });
        setActionMessage(`Deleted ${deleted} appeal(s) from that student.`);
      },
    });

  const openReply = (
    kind: 'report' | 'appeal',
    id: string,
    chip: string,
    contact: string | null
  ) => {
    setReplyTarget({ kind, id, chip, contact });
    setReplyTitle(kind === 'report' ? 'Reply to your question report' : 'Reply to your appeal');
    setReplyBody('');
    setReplyResult(null);
  };

  const sendReply = async () => {
    if (!replyTarget) return;
    if (!replyBody.trim()) {
      setReplyResult('Write a message before sending.');
      return;
    }
    setBusy(true);
    setReplyResult(null);
    try {
      const result = await cloud.adminReply(adminToken, {
        kind: replyTarget.kind,
        id: replyTarget.id,
        title: replyTitle.trim() || 'Reply from HDSAT',
        body: replyBody.trim(),
      });
      setReplyResult(
        result.delivered
          ? 'Delivered — the student will see this once on their Dashboard.'
          : 'This report has no account attached, so it cannot reach a Dashboard; reply to the contact email instead.'
      );
      setReplyBody('');
      reload();
    } catch (err) {
      setReplyResult((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const backToApp = () => {
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/');
    }
    navigate('/');
  };

  const unlockConsole = async () => {
    if (!gateQuestion) return;
    setGateBusy(true);
    setGateMessage(null);
    try {
      const result = await cloud.adminUnlock({
        passcode: gatePasscode,
        captchaId: gateQuestion.id,
        captchaAnswer: gateCaptcha,
      });
      if (result.ok && result.token) {
        window.sessionStorage.setItem(ADMIN_TOKEN_KEY, result.token);
        setAdminToken(result.token);
        setGatePasscode('');
        setGateCaptcha('');
        setAccess('ok');
        reload();
        return;
      }
      setGateMessage(result.message ?? 'Could not unlock the console.');
      setGatePasscode('');
      setGateCaptcha('');
      const next = await cloud.adminCaptchaChallenge();
      setGateQuestion(next);
    } catch (err) {
      setGateMessage((err as Error).message);
    } finally {
      setGateBusy(false);
    }
  };

  const lockConsole = async () => {
    const current = adminToken;
    window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdminToken('');
    setReports(null);
    setAppeals(null);
    setStudents(null);
    setSelected(new Set());
    setAccess('locked');
    setAccessToken((value) => value + 1);
    if (current) {
      try {
        await cloud.adminLock(current);
      } catch {
        /* the token is already gone locally and expires on the server */
      }
    }
  };

  const permissionCard = () => {
    if (access === 'unconfigured') {
      return (
        <section className="adm-card">
          <h2>Supabase is not configured</h2>
          <p className="adm-dim">
            This console reads from Supabase. Set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> for this deployment, then reload.
          </p>
        </section>
      );
    }

    if (access === 'signed-out') {
      return (
        <section className="adm-card">
          <h2>Sign in first</h2>
          <p className="adm-dim">
            The console asks for two things: a signed-in session, and the operator passcode plus a
            captcha. It is not tied to any particular account.
          </p>
          <a className="adm-btn" href="#/account">
            Go to sign in
          </a>
        </section>
      );
    }

    if (access === 'checking') {
      return (
        <section className="adm-card">
          <p className="adm-dim">Restoring your console session…</p>
        </section>
      );
    }

    if (access === 'error') {
      return (
        <section className="adm-card">
          <h2>Could not reach the console</h2>
          <p className="adm-dim">{accessError ?? 'Unknown error.'}</p>
          <button
            type="button"
            className="adm-btn"
            onClick={() => setAccessToken((value) => value + 1)}
          >
            Try again
          </button>
        </section>
      );
    }

    return (
      <section className="adm-card">
        <h2>Operator passcode</h2>
        <p className="adm-dim">
          Enter the operator passcode and answer the captcha. Five wrong tries lock the console for
          15 minutes. The passcode is compared inside the database against a bcrypt hash — it is
          never stored in this app, never logged, and never sent anywhere except that check.
        </p>
        <div className="adm-composer">
          <label className="adm-dim" htmlFor="admin-passcode">
            Passcode
          </label>
          <input
            id="admin-passcode"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={gatePasscode}
            onChange={(e) => setGatePasscode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void unlockConsole();
            }}
            placeholder="Operator passcode"
            aria-label="Operator passcode"
          />
          <label className="adm-dim" htmlFor="admin-captcha">
            Captcha {gateQuestion ? `— ${gateQuestion.question}` : '— loading…'}
          </label>
          <input
            id="admin-captcha"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={gateCaptcha}
            onChange={(e) => setGateCaptcha(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void unlockConsole();
            }}
            placeholder="Answer the captcha"
            aria-label="Captcha answer"
          />
          <div className="adm-composer-foot">
            <button
              type="button"
              className="adm-btn"
              onClick={() => void unlockConsole()}
              disabled={gateBusy || !gateQuestion || !gatePasscode || !gateCaptcha}
            >
              {gateBusy ? 'Checking…' : 'Unlock console'}
            </button>
            <button
              type="button"
              className="adm-btn adm-btn-ghost"
              disabled={gateBusy}
              onClick={() => {
                setGateMessage(null);
                setAccessToken((value) => value + 1);
              }}
            >
              New captcha
            </button>
          </div>
          {gateMessage ? <p className="adm-dim">{gateMessage}</p> : null}
        </div>
      </section>
    );
  };

  const replyComposer = () => (
    <section className="adm-card">
      <div className="adm-card-head">
        <h2>Reply composer</h2>
        <span className="adm-dim">
          {replyTarget ? 'One notification, shown once on the student Dashboard' : 'Pick a row'}
        </span>
      </div>
      {!replyTarget ? (
        <p className="adm-dim">Use the Reply action on a report or appeal to write back.</p>
      ) : (
        <div className="adm-composer">
          <div className="adm-composer-to">
            <span className="adm-dim">To</span>
            <span className="adm-chip">{replyTarget.chip}</span>
          </div>
          {replyTarget.contact ? (
            <p className="adm-dim" style={{ margin: 0 }}>
              Contact email: {replyTarget.contact}
            </p>
          ) : (
            <p className="adm-dim" style={{ margin: 0 }}>
              No contact email on file for this row.
            </p>
          )}
          <input
            type="text"
            value={replyTitle}
            maxLength={140}
            onChange={(e) => setReplyTitle(e.target.value)}
            placeholder="Subject"
            aria-label="Reply subject"
          />
          <textarea
            value={replyBody}
            maxLength={2000}
            rows={4}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Explain what you found or changed. This appears on the student's Dashboard once."
            aria-label="Reply message"
          />
          <div className="adm-composer-foot">
            <button
              type="button"
              className="adm-btn"
              onClick={() => void sendReply()}
              disabled={busy || !replyBody.trim()}
            >
              {busy ? 'Sending…' : 'Send reply'}
            </button>
            <button
              type="button"
              className="adm-btn adm-btn-ghost"
              onClick={() => {
                setReplyTarget(null);
                setReplyResult(null);
              }}
            >
              Close
            </button>
          </div>
          {replyResult ? (
            <p className="adm-dim" style={{ margin: 0 }}>
              {replyResult}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );

  const confirmBar = () =>
    pendingConfirm ? (
      <div className="adm-filters" role="alert">
        <span className="adm-filter">{pendingConfirm.prompt}</span>
        <button
          type="button"
          className="adm-row-action"
          disabled={busy}
          onClick={() => void runAction(null, pendingConfirm.run)}
        >
          Yes, delete
        </button>
        <button
          type="button"
          className="adm-row-action"
          onClick={() => setPendingConfirm(null)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    ) : null;

  const batchBar = () => (
    <>
      <div className="adm-filters">
        <button
          type="button"
          className="adm-row-action"
          disabled={selected.size === 0 || busy}
          onClick={() => void setStatusForSelected('resolved')}
        >
          Mark resolved ({selected.size})
        </button>
        <button
          type="button"
          className="adm-row-action"
          disabled={selected.size === 0 || busy}
          onClick={() =>
            void setStatusForSelected(section === 'reports' ? 'dismissed' : 'rejected')
          }
        >
          Mark {section === 'reports' ? 'dismissed' : 'rejected'} ({selected.size})
        </button>
        <button
          type="button"
          className="adm-row-action"
          disabled={selected.size === 0 || busy}
          onClick={deleteSelected}
        >
          Delete selected ({selected.size})
        </button>
        {section === 'reports' ? (
          <button type="button" className="adm-row-action" disabled={busy} onClick={cleanupResolved}>
            Delete resolved older than 7 days
          </button>
        ) : null}
      </div>
      {confirmBar()}
    </>
  );

  const filterRow = (statuses: string[], withReason: boolean) => (
    <div className="adm-filters">
      <select
        className="adm-filter"
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        aria-label="Filter by status"
      >
        <option value="">Any status</option>
        {statuses.map((status) => (
          <option key={status} value={status}>
            {status.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      {withReason ? (
        <select
          className="adm-filter"
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value)}
          aria-label="Filter by reason"
        >
          <option value="">All reasons</option>
          {reasonOptions.map((reason) => (
            <option key={reason} value={reason}>
              {reasonLabel(reason)}
            </option>
          ))}
        </select>
      ) : null}
      <button type="button" className="adm-row-action" onClick={reload} disabled={loading}>
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );

  const overviewActivity = useMemo(() => {
    const merged = [
      ...reportItems.map((row) => ({
        id: `r-${row.id}`,
        at: row.created_at,
        text: `Report ${shortId(row.id)} · ${reasonLabel(row.reason)} on ${row.question_id}`,
      })),
      ...appealItems.map((row) => ({
        id: `a-${row.id}`,
        at: row.created_at,
        text: `Appeal ${row.reference} · ${row.category.replace(/_/g, ' ')}`,
      })),
    ];
    return merged
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 6);
  }, [reportItems, appealItems]);

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
          <span className="adm-preview-tag">Live data</span>
          {access === 'ok' ? (
            <button type="button" className="adm-back" onClick={() => void lockConsole()}>
              <Icon name="shield" size={14} />
              <span>Lock console</span>
            </button>
          ) : null}
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
              {item.id === 'reports' && openReports > 0 ? <em>{openReports}</em> : null}
              {item.id === 'appeals' && openAppeals > 0 ? <em>{openAppeals}</em> : null}
            </button>
          ))}

          <div className="adm-rail-foot">
            <span className="adm-rail-note">
              Replies reach the student&apos;s Dashboard once. Deleting a report never changes the
              question for anyone else.
            </span>
          </div>
        </nav>

        <main className="adm-main">
          {access !== 'ok' ? permissionCard() : null}

          {access === 'ok' ? (
            <>
              {error ? (
                <section className="adm-card">
                  <p className="adm-dim">Could not load this section: {error}</p>
                  <button type="button" className="adm-row-action" onClick={reload}>
                    Try again
                  </button>
                </section>
              ) : null}
              {actionMessage ? (
                <p className="adm-dim" style={{ margin: '0 0 10px' }} role="status">
                  {actionMessage}
                </p>
              ) : null}

              {section === 'overview' ? (
                <>
                  <SectionHead
                    title="Overview"
                    blurb="Everything waiting on a human: content reports, safety appeals and catalog health."
                  />

                  <div className="adm-metrics">
                    <Metric
                      label="Open reports"
                      value={String(openReports)}
                      hint={`${reportItems.length} loaded of ${reports?.total ?? 0}`}
                      tone={openReports > 0 ? 'warn' : undefined}
                    />
                    <Metric
                      label="Appeals awaiting reply"
                      value={String(openAppeals)}
                      hint={`${appealItems.length} loaded of ${appeals?.total ?? 0}`}
                      tone={openAppeals > 0 ? 'warn' : undefined}
                    />
                    <Metric
                      label="Questions in bank"
                      value={app.questions.length.toLocaleString()}
                      hint="From this deployment's catalog"
                    />
                    <Metric
                      label="Flashcards"
                      value={app.flashcards.length.toLocaleString()}
                      hint="Spaced-repetition deck"
                    />
                  </div>

                  <div className="adm-columns">
                    <section className="adm-card">
                      <div className="adm-card-head">
                        <h2>Triage queue</h2>
                        <span className="adm-dim">Newest first</span>
                      </div>
                      {loading && reportItems.length === 0 ? (
                        <p className="adm-dim">Loading reports…</p>
                      ) : reportItems.length === 0 ? (
                        <p className="adm-dim">No reports yet.</p>
                      ) : (
                        <ul className="adm-queue">
                          {reportItems.slice(0, 4).map((row) => (
                            <li key={row.id}>
                              <span className="adm-queue-dot" aria-hidden="true" />
                              <div>
                                <strong>{reasonLabel(row.reason)}</strong>
                                <span className="adm-dim">
                                  {shortId(row.id)} ·{' '}
                                  <span className="mono">{row.question_id}</span> ·{' '}
                                  {relativeAge(row.created_at)} ago
                                </span>
                              </div>
                              <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section className="adm-card">
                      <div className="adm-card-head">
                        <h2>Appeals by status</h2>
                        <span className="adm-dim">{appeals?.total ?? 0} total</span>
                      </div>
                      <ul className="adm-checks">
                        {APPEAL_STATUSES.map((status) => {
                          const count = appealItems.filter((row) => row.status === status).length;
                          return (
                            <li key={status}>
                              <span>{status.replace(/_/g, ' ')}</span>
                              <Badge tone={statusTone(status)}>{count}</Badge>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  </div>

                  <section className="adm-card">
                    <div className="adm-card-head">
                      <h2>Recent activity</h2>
                      <span className="adm-dim">Reports and appeals</span>
                    </div>
                    {overviewActivity.length === 0 ? (
                      <p className="adm-dim">Nothing has been reported yet.</p>
                    ) : (
                      <ul className="adm-timeline">
                        {overviewActivity.map((item) => (
                          <li key={item.id}>
                            <span className="adm-time">{relativeAge(item.at)}</span>
                            <span>{item.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </>
              ) : null}

              {section === 'reports' ? (
                <>
                  <SectionHead
                    title="Question reports"
                    blurb="Student-submitted content problems. Reviewing one never changes the item for anyone else."
                  />
                  {filterRow(REPORT_STATUSES, true)}
                  {batchBar()}

                  <section className="adm-card adm-card-flush">
                    <table className="adm-table">
                      <thead>
                        <tr>
                          <th>
                            <input
                              type="checkbox"
                              checked={allVisibleSelected}
                              onChange={toggleSelectAll}
                              aria-label="Select all visible reports"
                            />
                          </th>
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
                        {reportItems.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selected.has(row.id)}
                                onChange={() => toggleSelected(row.id)}
                                aria-label={`Select report ${shortId(row.id)}`}
                              />
                            </td>
                            <td className="mono">{shortId(row.id)}</td>
                            <td className="mono">{row.question_id}</td>
                            <td>
                              {reasonLabel(row.reason)}
                              {row.details ? (
                                <div className="adm-dim" style={{ maxWidth: 320 }}>
                                  {row.details.slice(0, 160)}
                                </div>
                              ) : null}
                            </td>
                            <td className="adm-dim">{reporterLabel(row)}</td>
                            <td className="adm-dim">{relativeAge(row.created_at)}</td>
                            <td>
                              <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="adm-row-action"
                                onClick={() =>
                                  openReply(
                                    'report',
                                    row.id,
                                    `Report ${shortId(row.id)} · ${reporterLabel(row)}`,
                                    row.contact_email ?? row.reporter_email
                                  )
                                }
                              >
                                Reply
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="adm-card-foot">
                      <span className="adm-dim">
                        {loading
                          ? 'Loading…'
                          : reportItems.length === 0
                            ? 'No reports yet.'
                            : `Showing ${reportItems.length} of ${reports?.total ?? 0} reports`}
                      </span>
                      <button type="button" className="adm-row-action" onClick={reload}>
                        Refresh
                      </button>
                    </div>
                  </section>
                  {replyComposer()}
                </>
              ) : null}

              {section === 'appeals' ? (
                <>
                  <SectionHead
                    title="Appeals & safety"
                    blurb="Copyright, access, data and safety requests. The published first-response target is 72 hours."
                  />

                  <div className="adm-metrics">
                    <Metric label="Open" value={String(openAppeals)} hint="Received or in review" />
                    <Metric
                      label="Total"
                      value={String(appeals?.total ?? 0)}
                      hint="All categories"
                    />
                    <Metric
                      label="Resolved"
                      value={String(
                        appealItems.filter((row) => row.status === 'resolved').length
                      )}
                      hint="Loaded rows only"
                    />
                  </div>

                  {filterRow(APPEAL_STATUSES, false)}
                  {batchBar()}

                  <section className="adm-card adm-card-flush">
                    <table className="adm-table">
                      <thead>
                        <tr>
                          <th>
                            <input
                              type="checkbox"
                              checked={allVisibleSelected}
                              onChange={toggleSelectAll}
                              aria-label="Select all visible appeals"
                            />
                          </th>
                          <th>Ref</th>
                          <th>Category</th>
                          <th>Subject</th>
                          <th>Reporter</th>
                          <th>Age</th>
                          <th>Status</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {appealItems.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selected.has(row.id)}
                                onChange={() => toggleSelected(row.id)}
                                aria-label={`Select appeal ${row.reference}`}
                              />
                            </td>
                            <td className="mono">{row.reference}</td>
                            <td>{row.category.replace(/_/g, ' ')}</td>
                            <td className="adm-dim">
                              {row.subject}
                              <div style={{ maxWidth: 320 }}>{row.details.slice(0, 160)}</div>
                            </td>
                            <td className="adm-dim">{reporterLabel(row)}</td>
                            <td className="adm-dim">{relativeAge(row.created_at)}</td>
                            <td>
                              <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="adm-row-action"
                                onClick={() =>
                                  openReply(
                                    'appeal',
                                    row.id,
                                    `Appeal ${row.reference} · ${reporterLabel(row)}`,
                                    row.contact_email ?? row.reporter_email
                                  )
                                }
                              >
                                Reply
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="adm-card-foot">
                      <span className="adm-dim">
                        {loading
                          ? 'Loading…'
                          : appealItems.length === 0
                            ? 'No appeals yet.'
                            : `Showing ${appealItems.length} of ${appeals?.total ?? 0} appeals`}
                      </span>
                      <button type="button" className="adm-row-action" onClick={reload}>
                        Refresh
                      </button>
                    </div>
                  </section>
                  {replyComposer()}
                </>
              ) : null}

              {section === 'students' ? (
                <>
                  <SectionHead
                    title="Students"
                    blurb="Accounts that have practised here, with the aggregate counts the console needs. Account deletion stays self-serve in the app."
                  />

                  <section className="adm-card adm-card-flush">
                    <table className="adm-table">
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Confirmed</th>
                          <th>Streak</th>
                          <th>Coins</th>
                          <th>Attempts</th>
                          <th>Reports</th>
                          <th>Joined</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {(students?.items ?? []).map((row) => (
                          <tr key={row.user_id}>
                            <td>
                              {row.display_name ?? 'Student'}
                              <div className="adm-dim">{row.email ?? row.user_id}</div>
                            </td>
                            <td>
                              <Badge tone={row.confirmed ? 'good' : 'warn'}>
                                {row.confirmed ? 'yes' : 'pending'}
                              </Badge>
                            </td>
                            <td>{row.current_streak > 0 ? `${row.current_streak} d` : '—'}</td>
                            <td>{row.hd_coins.toLocaleString()}</td>
                            <td>{row.total_attempts.toLocaleString()}</td>
                            <td>{row.report_count}</td>
                            <td className="adm-dim">{row.created_at.slice(0, 10)}</td>
                            <td>
                              <div className="row" style={{ gap: 6 }}>
                                <button
                                  type="button"
                                  className="adm-row-action"
                                  onClick={() => deleteStudentReports(row)}
                                  disabled={row.report_count === 0}
                                >
                                  Delete reports
                                </button>
                                <button
                                  type="button"
                                  className="adm-row-action"
                                  onClick={() => deleteStudentAppeals(row)}
                                >
                                  Delete appeals
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="adm-card-foot">
                      <span className="adm-dim">
                        {loading
                          ? 'Loading…'
                          : (students?.items ?? []).length === 0
                            ? 'No accounts yet.'
                            : `Showing ${(students?.items ?? []).length} of ${
                                students?.total ?? 0
                              } accounts`}
                      </span>
                      <button type="button" className="adm-row-action" onClick={reload}>
                        Refresh
                      </button>
                    </div>
                  </section>
                  {confirmBar()}
                </>
              ) : null}

              {section === 'content' ? (
                <>
                  <SectionHead
                    title="Content health"
                    blurb="Counts from the catalog this deployment is serving. Reports are the content signal that needs a human."
                  />

                  <div className="adm-columns">
                    <section className="adm-card">
                      <div className="adm-card-head">
                        <h2>Bank summary</h2>
                        <span className="adm-dim">bank {app.bankVersion}</span>
                      </div>
                      <ul className="adm-checks">
                        <li>
                          <span>Questions</span>
                          <strong>{app.questions.length.toLocaleString()}</strong>
                        </li>
                        <li>
                          <span>Reading &amp; Writing</span>
                          <strong>
                            {app.questions
                              .filter((q) => q.section === 'Reading and Writing')
                              .length.toLocaleString()}
                          </strong>
                        </li>
                        <li>
                          <span>Math</span>
                          <strong>
                            {app.questions
                              .filter((q) => q.section === 'Math')
                              .length.toLocaleString()}
                          </strong>
                        </li>
                        <li>
                          <span>Flashcards</span>
                          <strong>{app.flashcards.length.toLocaleString()}</strong>
                        </li>
                      </ul>
                    </section>

                    <section className="adm-card">
                      <div className="adm-card-head">
                        <h2>Report signal</h2>
                      </div>
                      <ul className="adm-checks">
                        {REPORT_STATUSES.map((status) => {
                          const count = reportItems.filter((row) => row.status === status).length;
                          return (
                            <li key={status}>
                              <span>{status.replace(/_/g, ' ')}</span>
                              <Badge tone={statusTone(status)}>{count}</Badge>
                            </li>
                          );
                        })}
                        <li>
                          <span>Distinct flagged questions</span>
                          <strong>
                            {new Set(reportItems.map((row) => row.question_id)).size}
                          </strong>
                        </li>
                      </ul>
                      <p className="adm-dim" style={{ marginBottom: 0 }}>
                        Counts cover the loaded page, not the whole history.
                      </p>
                    </section>
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
