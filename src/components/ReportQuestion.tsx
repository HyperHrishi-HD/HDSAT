import { useState } from 'react';
import { Alert, Button, Select } from './ui';
import * as cloud from '../lib/cloud';
import { useApp } from '../lib/store';
import { QUESTION_REPORT_REASONS } from '../lib/legal';

/**
 * In-question "report a problem" control. This is the first-line content failsafe:
 * a wrong key, a broken figure or unsafe wording is one click away from a report,
 * signed in or anonymously. Reports land in public.question_reports for the
 * operator to triage; they never alter the question for other students.
 */
export function ReportQuestion({ questionId }: { questionId: string }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(QUESTION_REPORT_REASONS[0].value);
  const [details, setDetails] = useState('');
  const [contactEmail, setContactEmail] = useState(app.user?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return <span className="report-question">Report received — thank you. Our team will review this item.</span>;
  }

  if (!app.cloudConfigured) {
    return (
      <span className="report-question">
        Found a problem? Use the <a href="#/account">appeal form</a> to tell us.
      </span>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await cloud.reportQuestion({ questionId, reason, details, contactEmail });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <span className="report-question">
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          Report a problem with this question
        </button>
      </span>
    );
  }

  if (!app.user) {
    return (
      <div className="report-question-form">
        <p className="muted" style={{ margin: '0 0 8px' }}>
          Please sign in to report a question (required for server safety and follow-up replies).
        </p>
        <div className="row">
          <Button
            type="button"
            size="sm"
            onClick={() => app.actions.openAuthModal(app.accountStatus === 'pending' ? 'verify' : 'signin')}
          >
            Sign in to report
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className="report-question-form" onSubmit={submit}>
      <Select
        label="What is wrong?"
        value={reason}
        onChange={setReason}
        options={QUESTION_REPORT_REASONS.map((r) => ({ value: r.value, label: r.label }))}
      />
      <label className="field">
        <span className="field-label">Details (optional)</span>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Tell us what you expected instead."
        />
      </label>
      <label className="field">
        <span className="field-label">Email (optional, for a reply)</span>
        <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
      </label>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="row">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Sending…' : 'Send report'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <span className="muted mono">{questionId}</span>
      </div>
    </form>
  );
}
