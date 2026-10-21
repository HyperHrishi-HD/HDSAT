import { useState } from 'react';
import { Badge, Button, Card, Icon, InfoTip, Stat } from '../components/ui';
import { ACHIEVEMENTS, STORE_ITEMS } from '../lib/catalog';
import { DAILY_FLASHCARD_COIN_CAP, DAILY_QUESTION_COIN_CAP } from '../lib/storage';
import { useApp } from '../lib/store';

export function RewardsPage() {
  const app = useApp();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const today = app.dailyActivity[app.dailyActivity.length - 1];
  const activeTheme = app.settings.activeTheme ?? null;
  const activeFlair = app.settings.activeFlair ?? null;

  const handleBuy = async (itemId: string, cost: number, name: string) => {
    const res = await app.actions.purchase(itemId, cost);
    if (res.ok) {
      setFeedback({ ok: true, text: `Unlocked and applied ${name}!` });
    } else {
      setFeedback({ ok: false, text: res.reason ?? 'Could not complete purchase.' });
    }
  };

  const handleEquip = (itemId: string, slot: 'theme' | 'flair' | 'utility', name: string) => {
    if (slot === 'theme') {
      const next = activeTheme === itemId ? null : itemId;
      app.actions.updateSettings({ activeTheme: next });
      setFeedback({
        ok: true,
        text: next ? `Applied ${name}.` : 'Restored default HDSAT Blue theme.',
      });
    } else {
      const next = activeFlair === itemId ? null : itemId;
      app.actions.updateSettings({ activeFlair: next });
      setFeedback({
        ok: true,
        text: next ? `Equipped ${name}.` : 'Removed profile emblem.',
      });
    }
  };

  return (
    <div>
      <Card>
        <div className="row-between">
          <div>
            <div className="row">
              <h1>Rewards &amp; Themes</h1>
              <InfoTip label="Earning rules">
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                  <li>
                    <strong>First attempt on a question:</strong> +1 HDCoin (once per question ID).
                  </li>
                  <li>
                    <strong>First correct solution:</strong> +1 additional HDCoin (daily cap:{' '}
                    {DAILY_QUESTION_COIN_CAP}).
                  </li>
                  <li>
                    <strong>Due flashcard review:</strong> +1 HDCoin (up to{' '}
                    {DAILY_FLASHCARD_COIN_CAP}/day).
                  </li>
                  <li>
                    <strong>Daily streak milestone:</strong> +5 HDCoins once/day (≥3 questions, ≥5
                    flashcards, or Practice Rush).
                  </li>
                  <li>
                    <strong>Full adaptive simulation:</strong> +25 HDCoins.
                  </li>
                </ul>
              </InfoTip>
            </div>
            <p className="muted">
              Earn HDCoins through practice, flashcards, and full tests to unlock UI themes and
              emblems.
            </p>
          </div>
          <Badge tone="good">{app.hdCoins} HDCoins</Badge>
        </div>

        <div className="card-grid" style={{ marginTop: 12 }}>
          <Stat
            label="HDCoins Balance"
            value={app.hdCoins}
            hint={`${today?.coinsEarned ?? 0} earned today`}
          />
          <Stat
            label="Current Streak"
            value={`${app.currentStreak} days`}
            hint={`Best: ${app.bestStreak} days`}
          />
          <Stat
            label="Achievements"
            value={`${app.achievements.length} / ${ACHIEVEMENTS.length}`}
          />
          <Stat
            label="Active Theme"
            value={
              activeTheme
                ? STORE_ITEMS.find((i) => i.id === activeTheme)?.name.replace(/ Theme$/, '') ??
                  'Custom'
                : 'HDSAT Blue'
            }
          />
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
          <div className="row-between">
            <h2>Theme &amp; Emblem Store</h2>
            {activeTheme ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  app.actions.updateSettings({ activeTheme: null });
                  setFeedback({ ok: true, text: 'Restored default HDSAT Blue theme.' });
                }}
              >
                Reset to Default Blue
              </Button>
            ) : null}
          </div>
          <div className="stack" style={{ marginTop: 12 }}>
            {STORE_ITEMS.map((item) => {
              const owned = app.ownedItems.includes(item.id);
              const canAfford = app.hdCoins >= item.cost;
              const isEquipped =
                item.slot === 'theme' ? activeTheme === item.id : activeFlair === item.id;
              return (
                <div key={item.id} className="muted-block row-between">
                  <div>
                    <div className="row">
                      {item.icon ? (
                        <span
                          className={`emblem-glyph${isEquipped ? ' is-active' : ''}`}
                          aria-hidden="true"
                        >
                          <Icon name={item.icon} size={14} />
                        </span>
                      ) : (
                        <span className={`theme-swatch theme-swatch-${item.id}`} />
                      )}
                      <strong>{item.name}</strong>
                      <Badge tone={isEquipped ? 'good' : 'neutral'}>
                        {isEquipped ? 'Active' : item.slot}
                      </Badge>
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {item.description}
                    </div>
                  </div>
                  <div className="row">
                    {owned ? (
                      <Button
                        size="sm"
                        variant={isEquipped ? 'primary' : 'outline'}
                        icon={isEquipped ? 'check' : 'palette'}
                        onClick={() => handleEquip(item.id, item.slot, item.name)}
                      >
                        {isEquipped ? 'Active' : 'Apply'}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        icon="coins"
                        disabled={!canAfford}
                        onClick={() => handleBuy(item.id, item.cost, item.name)}
                      >
                        Unlock ({item.cost})
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <h2>Achievements</h2>
          <div className="stack" style={{ marginTop: 10 }}>
            {ACHIEVEMENTS.map((ach) => {
              const earned = app.achievements.includes(ach.id);
              return (
                <div key={ach.id} className="muted-block row-between">
                  <div>
                    <strong>{ach.name}</strong>
                    <div className="muted">{ach.description}</div>
                  </div>
                  <Badge tone={earned ? 'good' : 'neutral'}>
                    {earned ? 'Unlocked' : 'Locked'}
                  </Badge>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
