import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Icon, type IconName } from '../components/ui';
import * as cloud from '../lib/cloud';
import { sha256Hex } from '../lib/sha256';
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

function statusLabel(status: string): string {
  const text = status.replace(/_/g, ' ');
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

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className="adm-metric">
      <span className="adm-metric-label">{label}</span>
      <span className={`adm-metric-value${tone ? ` is-${tone}` : ''}`}>{value}</span>
    </div>
  );
}

function SectionHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="adm-section-head">
      <h1>{title}</h1>
      {action ? (
        <button type="button" className="adm-btn adm-btn-ghost" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}

type AccessState = 'checking' | 'ok' | 'locked' | 'signed-out' | 'unconfigured' | 'error';

/** Where the short-lived console token lives. Removed on lock, tab close and passcode change. */
const ADMIN_TOKEN_KEY = 'hdsat.admin.token';

/* ---------------------------------------------------------------------------
 * Human check: server-issued proof of work, solved in this tab.
 * ------------------------------------------------------------------------- */
const CHALLENGE_BATCH = 3000;
const CHALLENGE_TIMEOUT_MS = 45000;

/** Find a nonce whose SHA-256(salt + nonce) has the requested zero nibbles. */
async function solveHumanChallenge(
  challenge: cloud.AdminHumanChallenge,
  onProgress: (nonce: number) => void
): Promise<number> {
  const prefix = '0'.repeat(challenge.difficulty);
  const deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
  let nonce = 0;

  while (Date.now() < deadline) {
    for (let round = 0; round < CHALLENGE_BATCH; round += 1) {
      if (sha256Hex(`${challenge.salt}${nonce}`).startsWith(prefix)) return nonce;
      nonce += 1;
    }
    onProgress(nonce);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  throw new Error('The check took too long. Try again.');
}

/** Remove every console artefact this browser could hold. */
function scrubConsoleTrace() {
  if (typeof window === 'undefined') return;
  try {
    for (const store of [window.sessionStorage, window.localStorage]) {
      for (let index = store.length - 1; index >= 0; index -= 1) {
        const key = store.key(index);
        if (key && key.toLowerCase().includes('admin')) store.removeItem(key);
      }
      store.removeItem(ADMIN_TOKEN_KEY);
    }
  } catch {
    /* storage can be blocked; nothing else to clean there */
  }
  try {
    for (const name of ['hdsat_admin', 'hdsat_admin_token', 'hdsat.admin.token']) {
      document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Strict`;
      document.cookie = `${name}=; Max-Age=0; path=/; domain=${window.location.hostname}; SameSite=Strict`;
    }
  } catch {
    /* cookies can be blocked too */
  }
}

export function AdminPage() {
  const app = useApp();
  const navigate = useNavigate();

  const [section, setSection] = useState<SectionId>('overview');
  const [access, setAccess] = useState<AccessState>('checking');
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState(0);
  const [adminToken, setAdminToken] = useState('');

  const [challenge, setChallenge] = useState<cloud.AdminHumanChallenge | null>(null);
  const [challengeState, setChallengeState] = useState<'loading' | 'ready' | 'running' | 'done' | 'error'>(
    'loading'
  );
  const [solvedNonce, setSolvedNonce] = useState<number | null>(null);
  const [gatePasscode, setGatePasscode] = useState('');
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

  const challengeRun = useRef(0);

  const reload = () => setReloadToken((token) => token + 1);

  // Access gate: a signed-in session plus the operator passcode and reCAPTCHA.
  // The passcode is only ever compared inside Postgres against a bcrypt hash.
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
        scrubConsoleTrace();
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

  // A fresh single-use challenge whenever the gate opens or a try fails.
  useEffect(() => {
    if (access !== 'locked') return;
    let cancelled = false;
    setChallenge(null);
    setSolvedNonce(null);
    setChallengeState('loading');
    cloud
      .adminHumanCheck()
      .then((next) => {
        if (cancelled) return;
        setChallenge(next);
        setChallengeState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setGateMessage((err as Error).message);
        setChallengeState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [access, accessToken]);

  const runHumanCheck = async () => {
    if (!challenge || challengeState === 'running' || challengeState === 'done') return;
    const run = challengeRun.current + 1;
    challengeRun.current = run;
    setChallengeState('running');
    setGateMessage(null);
    try {
      const nonce = await solveHumanChallenge(challenge, () => undefined);
      if (challengeRun.current !== run) return;
      setSolvedNonce(nonce);
      setChallengeState('done');
    } catch (err) {
      if (challengeRun.current !== run) return;
      setGateMessage((err as Error).message);
      setChallengeState('ready');
    }
  };

  useEffect(() => {
    setSelected(new Set());
    setActionMessage(null);
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
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

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
    runAction(`Updated ${selected.size} item(s).`, async () => {
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
        setActionMessage(`Deleted ${deleted}.`);
      },
    });

  const cleanupResolved = () =>
    setPendingConfirm({
      prompt: 'Delete every resolved report older than 7 days?',
      run: async () => {
        const deleted = await cloud.adminBatchDeleteReports(adminToken, {
          status: 'resolved',
          olderThanDays: 7,
        });
        setActionMessage(`Deleted ${deleted} old report(s).`);
      },
    });

  const deleteStudentReports = (row: cloud.AdminStudentRow) =>
    setPendingConfirm({
      prompt: `Delete every report from ${row.email ?? row.display_name ?? 'this student'}?`,
      run: async () => {
        const deleted = await cloud.adminBatchDeleteReports(adminToken, { userId: row.user_id });
        setActionMessage(`Deleted ${deleted} report(s).`);
      },
    });

  const deleteStudentAppeals = (row: cloud.AdminStudentRow) =>
    setPendingConfirm({
      prompt: `Delete every appeal from ${row.email ?? row.display_name ?? 'this student'}?`,
      run: async () => {
        const deleted = await cloud.adminBatchDeleteAppeals(adminToken, { userId: row.user_id });
        setActionMessage(`Deleted ${deleted} appeal(s).`);
      },
    });

  const openReply = (kind: 'report' | 'appeal', id: string, chip: string, contact: string | null) => {
    setReplyTarget({ kind, id, chip, contact });
    setReplyTitle(kind === 'report' ? 'Reply to your question report' : 'Reply to your appeal');
    setReplyBody('');
    setReplyResult(null);
  };

  const sendReply = async () => {
    if (!replyTarget) return;
    if (!replyBody.trim()) {
      setReplyResult('Write a message first.');
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
        result.delivered ? 'Sent to the student’s Dashboard.' : 'No account attached — reply by email.'
      );
      setReplyBody('');
      reload();
    } catch (err) {
      setReplyResult((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const refreshChallenge = () => {
    setSolvedNonce(null);
    setChallenge(null);
    setChallengeState('loading');
    setAccessToken((value) => value + 1);
  };

  const backToApp = () => {
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/');
    }
    navigate('/');
  };

  const unlockConsole = async () => {
    if (solvedNonce === null || !challenge) {
      setGateMessage('Complete the human check first.');
      return;
    }
    setGateBusy(true);
    setGateMessage(null);
    try {
      const result = await cloud.adminUnlock({
        passcode: gatePasscode,
        challengeId: challenge.id,
        nonce: solvedNonce,
      });
      if (result.ok && result.token) {
        window.sessionStorage.setItem(ADMIN_TOKEN_KEY, result.token);
        setAdminToken(result.token);
        setGatePasscode('');
        setGateMessage(null);
        setAccess('ok');
        reload();
        return;
      }
      setGateMessage(result.message ?? 'Could not unlock the console.');
      setGatePasscode('');
      refreshChallenge();
    } catch (err) {
      setGateMessage((err as Error).message);
      refreshChallenge();
    } finally {
      setGateBusy(false);
    }
  };

  // Lock: revoke server-side, wipe storage/cookies, drop every in-memory copy,
  // remove the admin route from history and leave the console.
  const lockConsole = async () => {
    const current = adminToken;
    scrubConsoleTrace();
    setAdminToken('');
    setReports(null);
    setAppeals(null);
    setStudents(null);
    setSelected(new Set());
    setReplyTarget(null);
    setReplyTitle('');
    setReplyBody('');
    setReplyResult(null);
    setActionMessage(null);
    setGatePasscode('');
    setGateMessage(null);
    setChallenge(null);
    setSolvedNonce(null);
    setChallengeState('loading');
    challengeRun.current += 1;
    if (current) {
      try {
        await cloud.adminLock(current);
      } catch {
        /* token is gone locally and expires on the server */
      }
    }
    if (typeof window !== 'undefined') window.history.replaceState(null, '', '/');
    navigate('/', { replace: true });
  };

  const permissionCard = () => {
    if (access === 'unconfigured') {
      return (
        <section className="adm-gate">
          <h1>Console unavailable</h1>
          <p className="adm-gate-msg">Supabase is not configured for this build.</p>
        </section>
      );
    }

    if (access === 'signed-out') {
      return (
        <section className="adm-gate">
          <h1>Sign in required</h1>
          <button type="button" className="adm-btn adm-btn-wide" onClick={() => navigate('/account')}>
            Go to sign in
          </button>
        </section>
      );
    }

    if (access === 'checking') {
      return (
        <section className="adm-gate">
          <p className="adm-gate-msg">Checking session…</p>
        </section>
      );
    }

    if (access === 'error') {
      return (
        <section className="adm-gate">
          <h1>Could not reach the console</h1>
          <p className="adm-gate-msg">{accessError ?? 'Unknown error.'}</p>
          <button
            type="button"
            className="adm-btn adm-btn-wide"
            onClick={() => setAccessToken((value) => value + 1)}
          >
            Try again
          </button>
        </section>
      );
    }

    if (challengeState === 'loading' && !challenge) {
      return (
        <section className="adm-gate">
          <p className="adm-gate-msg">Loading…</p>
        </section>
      );
    }

    if (challengeState === 'error' && !challenge) {
      return (
        <section className="adm-gate">
          <h1>Operator access</h1>
          <p className="adm-gate-msg">{gateMessage ?? 'The human check could not load.'}</p>
          <button type="button" className="adm-btn adm-btn-wide" onClick={refreshChallenge}>
            Try again
          </button>
        </section>
      );
    }

    const verified = challengeState === 'done' && solvedNonce !== null;
    const checking = challengeState === 'running';

    return (
      <section className="adm-gate">
        <h1>Operator access</h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (verified) void unlockConsole();
          }}
        >
          <label htmlFor="admin-passcode">Passcode</label>
          <input
            id="admin-passcode"
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={gatePasscode}
            onChange={(event) => setGatePasscode(event.target.value)}
            placeholder="Passcode"
          />
          <button
            type="button"
            role="checkbox"
            aria-checked={verified}
            className={`adm-human${verified ? ' is-checked' : ''}`}
            onClick={() => void runHumanCheck()}
            disabled={checking || verified || !challenge}
          >
            <span className="adm-human-box" aria-hidden="true">
              {verified ? '✓' : checking ? '•' : ''}
            </span>
            <span className="adm-human-label">
              {verified ? 'Verified' : checking ? 'Checking…' : 'I\u2019m not a robot'}
            </span>
          </button>
          {gateMessage ? (
            <p className="adm-gate-msg" role="alert">
              {gateMessage}
            </p>
          ) : null}
          <button type="submit" className="adm-btn adm-btn-wide" disabled={gateBusy || !gatePasscode || !verified}>
            {gateBusy ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      </section>
    );
  };

  const replyComposer = () =>
    replyTarget ? (
      <section className="adm-card">
        <div className="adm-card-head">
          <h2>Reply</h2>
          <span className="adm-chip">{replyTarget.chip}</span>
        </div>
        <div className="adm-composer">
          <p className="adm-dim" style={{ margin: 0 }}>
            {replyTarget.contact ?? 'No contact email on file.'}
          </p>
          <input
            type="text"
            value={replyTitle}
            maxLength={140}
            onChange={(event) => setReplyTitle(event.target.value)}
            placeholder="Subject"
            aria-label="Reply subject"
          />
          <textarea
            value={replyBody}
            maxLength={2000}
            rows={4}
            onChange={(event) => setReplyBody(event.target.value)}
            placeholder="Write your reply…"
            aria-label="Reply message"
          />
          <div className="adm-composer-foot">
            <button
              type="button"
              className="adm-btn"
              onClick={() => void sendReply()}
              disabled={busy || !replyBody.trim()}
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
            <button
              type="button"
              className="adm-btn adm-btn-ghost"
              onClick={() => {
                setReplyTarget(null);
                setReplyResult(null);
              }}
            >
              Cancel
            </button>
          </div>
          {replyResult ? (
            <p className="adm-dim" style={{ margin: 0 }} role="status">
              {replyResult}
            </p>
          ) : null}
        </div>
      </section>
    ) : null;

  const confirmBar = () =>
    pendingConfirm ? (
      <div className="adm-confirm" role="alert">
        <span>{pendingConfirm.prompt}</span>
        <button
          type="button"
          className="adm-btn"
          disabled={busy}
          onClick={() => void runAction(null, pendingConfirm.run)}
        >
          Delete
        </button>
        <button
          type="button"
          className="adm-btn adm-btn-ghost"
          onClick={() => setPendingConfirm(null)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    ) : null;

  const batchBar = () =>
    selected.size === 0 ? null : (
      <div className="adm-batch">
        <span className="adm-batch-count">{selected.size} selected</span>
        <button
          type="button"
          className="adm-row-action"
          disabled={busy}
          onClick={() => void setStatusForSelected('resolved')}
        >
          Resolve
        </button>
        <button
          type="button"
          className="adm-row-action"
          disabled={busy}
          onClick={() => void setStatusForSelected(section === 'reports' ? 'dismissed' : 'rejected')}
        >
          {section === 'reports' ? 'Dismiss' : 'Reject'}
        </button>
        <button type="button" className="adm-row-action" disabled={busy} onClick={deleteSelected}>
          Delete
        </button>
      </div>
    );

  const filterRow = (statuses: string[], withReason: boolean) => (
    <div className="adm-toolbar">
      <select
        className="adm-filter"
        value={statusFilter}
        onChange={(event) => setStatusFilter(event.target.value)}
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        {statuses.map((status) => (
          <option key={status} value={status}>
            {statusLabel(status)}
          </option>
        ))}
      </select>
      {withReason ? (
        <select
          className="adm-filter"
          value={reasonFilter}
          onChange={(event) => setReasonFilter(event.target.value)}
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
      <button
        type="button"
        className="adm-row-action adm-toolbar-end"
        onClick={reload}
        disabled={loading}
      >
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
      {section === 'reports' ? (
        <button type="button" className="adm-row-action" disabled={busy} onClick={cleanupResolved}>
          Clear resolved (7d+)
        </button>
      ) : null}
    </div>
  );

  const overviewActivity = useMemo(() => {
    const merged = [
      ...reportItems.map((row) => ({
        id: `r-${row.id}`,
        at: row.created_at,
        text: `Report ${shortId(row.id)} · ${reasonLabel(row.reason)} · ${row.question_id}`,
      })),
      ...appealItems.map((row) => ({
        id: `a-${row.id}`,
        at: row.created_at,
        text: `Appeal ${row.reference} · ${reasonLabel(row.category)}`,
      })),
    ];
    return merged.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
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
        </nav>

        <main className="adm-main">
          {access !== 'ok' ? permissionCard() : null}

          {access === 'ok' ? (
            <>
              {error ? (
                <div className="adm-confirm" role="alert">
                  <span>{error}</span>
                  <button type="button" className="adm-row-action" onClick={reload}>
                    Try again
                  </button>
                </div>
              ) : null}
              {actionMessage ? (
                <p className="adm-status" role="status">
                  {actionMessage}
                </p>
              ) : null}

              {section === 'overview' ? (
                <>
                  <SectionHead title="Overview" />

                  <div className="adm-metrics">
                    <Metric
                      label="Open reports"
                      value={String(openReports)}
                      tone={openReports > 0 ? 'warn' : undefined}
                    />
                    <Metric
                      label="Open appeals"
                      value={String(openAppeals)}
                      tone={openAppeals > 0 ? 'warn' : undefined}
                    />
                    <Metric label="Questions" value={app.questions.length.toLocaleString()} />
                    <Metric label="Flashcards" value={app.flashcards.length.toLocaleString()} />
                  </div>

                  <div className="adm-columns">
                    <section className="adm-card">
                      <div className="adm-card-head">
                        <h2>Latest reports</h2>
                        <button type="button" className="adm-row-action" onClick={() => setSection('reports')}>
                          View all
                        </button>
                      </div>
                      {loading && reportItems.length === 0 ? (
                        <p className="adm-dim">Loading…</p>
                      ) : reportItems.length === 0 ? (
                        <p className="adm-dim">No reports.</p>
                      ) : (
                        <ul className="adm-queue">
                          {reportItems.slice(0, 4).map((row) => (
                            <li key={row.id}>
                              <span className="adm-queue-dot" aria-hidden="true" />
                              <div>
                                <strong>{reasonLabel(row.reason)}</strong>
                                <span className="adm-dim">
                                  {shortId(row.id)} · <span className="mono">{row.question_id}</span> ·{' '}
                                  {relativeAge(row.created_at)}
                                </span>
                              </div>
                              <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section className="adm-card">
                      <div className="adm-card-head">
                        <h2>Appeals</h2>
                        <button type="button" className="adm-row-action" onClick={() => setSection('appeals')}>
                          View all
                        </button>
                      </div>
                      <ul className="adm-checks">
                        {APPEAL_STATUSES.map((status) => {
                          const count = appealItems.filter((row) => row.status === status).length;
                          return (
                            <li key={status}>
                              <span>{statusLabel(status)}</span>
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
                    </div>
                    {overviewActivity.length === 0 ? (
                      <p className="adm-dim">Nothing yet.</p>
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
                  <SectionHead title="Question reports" />
                  {filterRow(REPORT_STATUSES, true)}
                  {batchBar()}
                  {confirmBar()}

                  <section className="adm-card adm-card-flush">
                    <div className="adm-table-wrap">
                      <table className="adm-table">
                        <thead>
                          <tr>
                            <th>
                              <input
                                type="checkbox"
                                checked={allVisibleSelected}
                                onChange={toggleSelectAll}
                                aria-label="Select all reports"
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
                                  <div className="adm-dim adm-clip">{row.details}</div>
                                ) : null}
                              </td>
                              <td className="adm-dim">{reporterLabel(row)}</td>
                              <td className="adm-dim">{relativeAge(row.created_at)}</td>
                              <td>
                                <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="adm-row-action"
                                  onClick={() =>
                                    openReply(
                                      'report',
                                      row.id,
                                      `Report ${shortId(row.id)}`,
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
                    </div>
                    <div className="adm-card-foot">
                      <span className="adm-dim">
                        {loading
                          ? 'Loading…'
                          : reportItems.length === 0
                            ? 'No reports.'
                            : `${reportItems.length} of ${reports?.total ?? 0} reports`}
                      </span>
                    </div>
                  </section>
                  {replyComposer()}
                </>
              ) : null}

              {section === 'appeals' ? (
                <>
                  <SectionHead title="Appeals & safety" />
                  {filterRow(APPEAL_STATUSES, false)}
                  {batchBar()}
                  {confirmBar()}

                  <section className="adm-card adm-card-flush">
                    <div className="adm-table-wrap">
                      <table className="adm-table">
                        <thead>
                          <tr>
                            <th>
                              <input
                                type="checkbox"
                                checked={allVisibleSelected}
                                onChange={toggleSelectAll}
                                aria-label="Select all appeals"
                              />
                            </th>
                            <th>Reference</th>
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
                              <td>{reasonLabel(row.category)}</td>
                              <td>
                                {row.subject}
                                <div className="adm-dim adm-clip">{row.details}</div>
                              </td>
                              <td className="adm-dim">{reporterLabel(row)}</td>
                              <td className="adm-dim">{relativeAge(row.created_at)}</td>
                              <td>
                                <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="adm-row-action"
                                  onClick={() =>
                                    openReply(
                                      'appeal',
                                      row.id,
                                      `Appeal ${row.reference}`,
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
                    </div>
                    <div className="adm-card-foot">
                      <span className="adm-dim">
                        {loading
                          ? 'Loading…'
                          : appealItems.length === 0
                            ? 'No appeals.'
                            : `${appealItems.length} of ${appeals?.total ?? 0} appeals`}
                      </span>
                    </div>
                  </section>
                  {replyComposer()}
                </>
              ) : null}

              {section === 'students' ? (
                <>
                  <SectionHead title="Students" />
                  {confirmBar()}

                  <section className="adm-card adm-card-flush">
                    <div className="adm-table-wrap">
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
                                  {row.confirmed ? 'Yes' : 'Pending'}
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
                    </div>
                    <div className="adm-card-foot">
                      <span className="adm-dim">
                        {loading
                          ? 'Loading…'
                          : (students?.items ?? []).length === 0
                            ? 'No accounts.'
                            : `${(students?.items ?? []).length} of ${students?.total ?? 0} accounts`}
                      </span>
                    </div>
                  </section>
                </>
              ) : null}

              {section === 'content' ? (
                <>
                  <SectionHead title="Content health" />

                  <div className="adm-columns">
                    <section className="adm-card">
                      <div className="adm-card-head">
                        <h2>Bank</h2>
                        <span className="adm-dim mono">{app.bankVersion}</span>
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
                              .filter((question) => question.section === 'Reading and Writing')
                              .length.toLocaleString()}
                          </strong>
                        </li>
                        <li>
                          <span>Math</span>
                          <strong>
                            {app.questions
                              .filter((question) => question.section === 'Math')
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
                        <h2>Reports</h2>
                      </div>
                      <ul className="adm-checks">
                        {REPORT_STATUSES.map((status) => {
                          const count = reportItems.filter((row) => row.status === status).length;
                          return (
                            <li key={status}>
                              <span>{statusLabel(status)}</span>
                              <Badge tone={statusTone(status)}>{count}</Badge>
                            </li>
                          );
                        })}
                        <li>
                          <span>Flagged questions</span>
                          <strong>{new Set(reportItems.map((row) => row.question_id)).size}</strong>
                        </li>
                      </ul>
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
