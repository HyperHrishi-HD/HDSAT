import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button } from './ui';
import { useApp } from '../lib/store';

/**
 * A miss clears itself from the retry list as soon as the item is answered
 * correctly, which is right for daily practice but loses the record. This is
 * the permanent side: every wrong answer this device kept, newest first, with
 * the date it happened. Nothing is editable and nothing expires.
 */
export function MissedLog() {
  const app = useApp();
  const [open, setOpen] = useState(false);

  const byId = useMemo(() => {
    const map = new Map(app.questions.map((q) => [q.id, q]));
    return map;
  }, [app.questions]);

  const missed = useMemo(
    () => app.attempts.filter((attempt) => !attempt.isCorrect).slice().reverse(),
    [app.attempts]
  );

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Missed log ({missed.length})
      </Button>

      {open ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Missed question log"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="modal-card missed-log">
            <div className="row-between" style={{ marginBottom: 10 }}>
              <div>
                <h2 style={{ margin: 0 }}>Missed log</h2>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  Every wrong answer kept on this device, newest first.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>

            {missed.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Nothing missed yet.
              </p>
            ) : (
              <>
                <div className="missed-log-list">
                  {missed.map((attempt) => {
                    const question = byId.get(attempt.questionId);
                    return (
                      <div className="missed-log-row" key={attempt.eventId}>
                        <div>
                          <div className="missed-log-meta">
                            <Badge tone="neutral">
                              {question?.section === 'Math' ? 'Math' : 'R&W'}
                            </Badge>
                            <span className="muted">
                              {attempt.createdAt.slice(0, 10)}
                              {question?.domain ? ` · ${question.domain}` : ''}
                            </span>
                          </div>
                          <p className="missed-log-prompt">
                            {question?.prompt ?? 'Question no longer in this bank'}
                          </p>
                        </div>
                        <div className="missed-log-answer">
                          <span className="muted">Your answer</span>
                          <strong>{attempt.response || '—'}</strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  <Link
                    to="/practice?mode=incorrect"
                    className="btn btn-primary btn-sm"
                    onClick={() => setOpen(false)}
                  >
                    Practice missed items
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
