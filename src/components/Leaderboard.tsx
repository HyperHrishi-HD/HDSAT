import { useEffect, useState } from 'react';
import { Skeleton } from 'skullet/react';
import { emblemFor } from '../lib/catalog';
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
const SAMPLE_LEADERBOARD: cloud.Leaderboard = {
  rows: [
    {
      rank: 1,
      displayName: 'Mira Solis',
      hdCoins: 8420,
      bestStreak: 31,
      totalAttempts: 960,
      isMe: false,
    },
    {
      rank: 2,
      displayName: 'Devon Park',
      hdCoins: 7115,
      bestStreak: 24,
      totalAttempts: 812,
      isMe: false,
    },
    {
      rank: 3,
      displayName: 'Anika Rao',
      hdCoins: 6480,
      bestStreak: 19,
      totalAttempts: 744,
      isMe: true,
    },
    {
      rank: 4,
      displayName: 'Lucas Bennett',
      hdCoins: 5920,
      bestStreak: 18,
      totalAttempts: 690,
      isMe: false,
    },
    {
      rank: 5,
      displayName: 'Priya Nair',
      hdCoins: 5340,
      bestStreak: 16,
      totalAttempts: 625,
      isMe: false,
    },
  ],
  myRank: 12,
  outsideTop: null,
  totalPlayers: 1420,
};

type ActiveEmblem = ReturnType<typeof emblemFor>;

function LeaderboardCard({
  board,
  activeEmblem,
}: {
  board: cloud.Leaderboard;
  activeEmblem: ActiveEmblem;
}) {
  const rows = board.rows;
  const outside = board.outsideTop;

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
          {board.totalPlayers > 0
            ? `Top ${Math.min(5, rows.length)} of ${board.totalPlayers}`
            : 'HDCoins'}
        </span>
      </div>

      {rows.length === 0 ? (
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
                {row.isMe && activeEmblem ? (
                  <span
                    className="leaderboard-emblem"
                    title={`${activeEmblem.name.replace(/ Emblem$/, '')} emblem equipped`}
                    aria-label={`${activeEmblem.name.replace(/ Emblem$/, '')} emblem equipped`}
                  >
                    <Icon name={activeEmblem.icon} size={12} />
                  </span>
                ) : null}
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

export function Leaderboard() {
  const app = useApp();
  const [board, setBoard] = useState<cloud.Leaderboard | null>(null);
  const [failed, setFailed] = useState(false);
  const activeEmblem = emblemFor(app.settings?.activeFlair);

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

  // Skullet renders the sample board invisibly, measures it, and keeps that
  // exact geometry under the card until the real rows arrive. The sample is
  // only a shape: it never has access to a real account or a real response.
  return (
    <Skeleton
      data={board}
      sample={SAMPLE_LEADERBOARD}
      id="dashboard-leaderboard"
      label="Loading leaderboard"
    >
      {(data) => <LeaderboardCard board={data} activeEmblem={activeEmblem} />}
    </Skeleton>
  );
}
