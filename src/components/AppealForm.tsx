import { useState } from 'react';
import { Alert, Button, Field, Select } from './ui';
import * as cloud from '../lib/cloud';
import { useApp } from '../lib/store';
import { APPEAL_CATEGORIES, APPEAL_SLA_HOURS, SITE_NAME, SUPPORT_EMAIL, contactLine } from '../lib/legal';

/**
 * Appeal / safety-report form. Works signed in or signed out: appeals are the
 * escalation path for content removal, access problems, data requests and
 * safety reports, and must never require an account to file.
 */
export function AppealForm({ defaultCategory = 'safety_report' }: { defaultCategory?: string }) {
  const app = useApp();
  const [category, setCategory] = useState(defaultCategory);
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');
  const [contactEmail, setContactEmail] = useState(app.user?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!subject.trim() || details.trim().length < 10) {
      setError('Add a short subject and at least a sentence describing the problem.');
      return;
    }
    setBusy(true);
    try {
      const ref = await cloud.submitAppeal({ category, subject, details, contactEmail });
      setReference(ref);
      setSubject('');
      setDetails('');
    } catch (err) {
      const message = (err as Error).message;
      setError(
        cloud.isMissingRelationError(message, 'user_appeals')
          ? `The appeal inbox is not enabled on this deployment yet, so your report was not recorded. ${
              SUPPORT_EMAIL ? `Please email ${SUPPORT_EMAIL} instead.` : 'Please try again shortly.'
            }`
          : message
      );
    } finally {
      setBusy(false);
    }
  };

  if (reference) {
    return (
      <Alert tone="notice">
        Appeal received. Your reference is <strong>{reference}</strong>. {SITE_NAME} reviews safety and copyright
        reports within {APPEAL_SLA_HOURS} hours and responds using the contact details you provided.
        {SUPPORT_EMAIL ? ` You can also follow up at ${SUPPORT_EMAIL}.` : ''}
      </Alert>
    );
  }

  return (
    <form onSubmit={submit}>
      <p className="muted">
        Use this form to report unsafe content, request removal of material, appeal an account decision, or ask for
        access to or deletion of your data. You do not need an account to file a report — you can reach us by{' '}
        {contactLine()}.
      </p>

      <Select
        label="What is this about?"
        value={category}
        onChange={setCategory}
        options={APPEAL_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
      />

      <Field label="Subject">
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Short summary"
          maxLength={200}
        />
      </Field>

      <Field
        label="Details"
        hint="If this is about a specific question, include the question id shown at the bottom of the question card."
      >
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={6}
          maxLength={8000}
          placeholder="Describe what happened and what outcome you are asking for."
        />
      </Field>

      <Field label="Contact email" hint="Optional when signed in. Required if you are not signed in.">
        <input
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </Field>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="row">
        <Button type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Submit appeal'}
        </Button>
        <span className="muted">Reviewed within {APPEAL_SLA_HOURS} hours.</span>
      </div>
    </form>
  );
}
