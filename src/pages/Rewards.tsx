import { useState } from 'react';
import { Badge, Button, Card, Stat } from '../components/ui';
import { ACHIEVEMENTS, STORE_ITEMS } from '../lib/catalog';
import { DAILY_FLASHCARD_COIN_CAP, DAILY_QUESTION_COIN_CAP } from '../lib/storage';
import { useApp } from '../lib/store';

export function RewardsPage() {
  const app = useApp();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const today = app.dailyActivity[app.dailyActivity.length - 1];

  const handleBuy = async (itemId: string, cost: number, name: string) => {
    const res = await app.actions.purchase(itemId, cost);
    if (res.ok) {
      setFeedback({ ok: true, text: `Unlocked ${name}!` });
    } else {
      setFeedback({ ok: false, text: res.reason ?? 'Could not complete purchase.' });
    }
  };

  return (
    <div>
      <Card>
        <div className="row-between">
          <div>
            <h1>HDCoins Economy, Streaks &amp; Achievements</h1>
            <p className="muted">
              Fair, duplicate-resistant rewards earned through verified practice questions, spaced-repetition reviews,
              and adaptive simulations.
            </p>
          </div>
          <Badge tone="good">{app.hdCoins} HDCoins available</Badge>
        </div>

        <div className="card-grid" style={{ marginTop: 12 }}>
          <Stat label="HDCoins Balance" value={app.hdCoins} hint={`${today?.coinsEarned ?? 0} earned today`} />
          <Stat label="Current Streak" value={`${app.currentStreak} days`} hint={`Best: ${app.bestStreak} days`} />
          <Stat
            label="Unlocked Achievements"
            value={`${app.achievements.length} / ${ACHIEVEMENTS.length}`}
          />
          <Stat label="Owned Cosmetics" value={app.ownedItems.length} />
        </div>
      </Card>

      {feedback ? (
        <Card>
          <p style={{ color: feedback.ok ? 'var(--good)' : 'var(--bad)', margin: 0 }}>
            <strong>{feedback.text}</strong>
          </p>
        </Card>
      ) : null}

      <div className="grid-2">
        <Card>
          <h2>HDCoins Reward Store</h2>
          <p className="muted">
            Unlock profile emblems and study palette accents using your earned HDCoins.
          </p>
          <div className="stack" style={{ marginTop: 12 }}>
            {STORE_ITEMS.map((item) => {
              const owned = app.ownedItems.includes(item.id);
              const canAfford = app.hdCoins >= item.cost;
              return (
                <div key={item.id} className="muted-block row-between">
                  <div>
                    <div className="row">
                      <strong>{item.name}</strong>
                      <Badge>{item.slot}</Badge>
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {item.description}
                    </div>
                  </div>
                  <div>
                    {owned ? (
                      <Badge tone="good">Owned</Badge>
                    ) : (
                      <Button
                        size="sm"
                        disabled={!canAfford}
                        onClick={() => handleBuy(item.id, item.cost, item.name)}
                      >
                        Unlock ({item.cost} HDCoins)
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="stack">
          <Card>
            <h2>Earning Rules &amp; Anti-Farming Caps</h2>
            <ul className="muted" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
              <li>
                <strong>First attempt on a question:</strong> +1 HDCoin (never awarded twice for the same question ID).
              </li>
              <li>
                <strong>First correct solution on a question:</strong> +1 additional HDCoin.
              </li>
              <li>
                <strong>Daily question reward cap:</strong> {DAILY_QUESTION_COIN_CAP} HDCoins/day.
              </li>
              <li>
                <strong>Spaced-repetition due flashcard review:</strong> +1 HDCoin per due card (up to{' '}
                {DAILY_FLASHCARD_COIN_CAP} HDCoins/day).
              </li>
              <li>
                <strong>Daily qualifying streak milestone:</strong> +5 HDCoins once per day when you complete ≥3
                questions, ≥5 flashcards, or a Practice Rush.
              </li>
              <li>
                <strong>Full adaptive simulation completion:</strong> +25 HDCoins (capped at 2 per day in cloud mode).
              </li>
            </ul>
          </Card>

          <Card>
            <h2>Scholar Achievements</h2>
            <div className="stack" style={{ marginTop: 10 }}>
              {ACHIEVEMENTS.map((ach) => {
                const earned = app.achievements.includes(ach.id);
                return (
                  <div key={ach.id} className="muted-block row-between">
                    <div>
                      <strong>{ach.name}</strong>
                      <div className="muted">{ach.description}</div>
                    </div>
                    <Badge tone={earned ? 'good' : 'neutral'}>{earned ? 'Unlocked' : 'Locked'}</Badge>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
