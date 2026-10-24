import { useEffect, useState } from 'react';
import { Card, Icon, InfoTip } from './ui';
import * as cloud from '../lib/cloud';
import { useApp } from '../lib/store';

/**
 * A small board at the foot of the Dashboard. It shows five names with a coin
 * balance and a best streak — nothing else. The database selects those three
 * fields plus the display name, and only a signed-in student can ask.
 *
 * A guest sees no board at all: there is nothing to compare, and the card
 * would only take up space on the page they are already using.
 */
export function Leaderboard() {
  const app = useApp();
  const [board, setBoard] = useState<cloud.Leaderboard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!app.user || !app.cloudConfigured) {
      setBoard(null);
      return;
    }
    let cancelled = false;
    void cloud
      .fetchLeaderboard(5)
      .then((data) => {
        if (!cancelled) {
          setBoard(data);
          setFailed(false);
        }
      })
      .catch(() => {
        // A missing RPC in an older database must never break the Dashboard.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [app.user, app.cloudConfigured, app.hdCoins]);

  if (!app.user || !app.cloudConfigured || failed) return null;

  const rows = board?.rows ?? [];
  const outside = board?.outsideTop ?? null;

  return (
    <Card className="leaderboard">
      <div className="row-between leaderboard-head">
        <div className="row">
          <h3>Leaderboard</h3>
          <InfoTip label="How the leaderboard works">
            The five students with the most HDCoins. Only a display name, the coin balance and the
            best streak are shared — never an email, an answer or any practice history. Everyone who
            has answered a question is ranked.
          </InfoTip>
        </div>
        <span className="muted leaderboard-count">
          {board && board.totalPlayers > 0
            ? `Top ${Math.min(5, board.rows.length)} of ${board.totalPlayers}`
            : 'HDCoins'}
        </span>
      </div>

      {!board ? (
        <p className="muted leaderboard-empty">Loading the board…</p>
      ) : rows.length === 0 ? (
        <p className="muted leaderboard-empty">
          Nobody is on the board yet. Answer a question to take first place.
        </p>
      ) : (
        <ol className="leaderboard-list">
          {rows.map((row) => (
            <li
              key={`${row.rank}-${row.displayName}`}
              className={row.isMe ? 'leaderboard-row is-me' : 'leaderboard-row'}
              aria-current={row.isMe ? 'true' : undefined}
            >
              <span className="leaderboard-rank">{row.rank}</span>
              <span className="leaderboard-name" title={row.displayName}>
                {row.displayName}
                {row.isMe ? <span className="leaderboard-you">you</span> : null}
              </span>
              <span className="leaderboard-stat">
                <Icon name="coins" size={13} />
                {row.hdCoins.toLocaleString()}
              </span>
              <span className="leaderboard-stat leaderboard-streak">
                <Icon name="flame" size={13} />
                {row.bestStreak}
              </span>
            </li>
          ))}
        </ol>
      )}

      {outside ? (
        <p className="leaderboard-mine">
          You are <strong>#{outside.rank}</strong> with{' '}
          <strong>{outside.hdCoins.toLocaleString()} HDCoins</strong>
        </p>
      ) : null}
    </Card>
  );
}
