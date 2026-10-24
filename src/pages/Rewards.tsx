import { useState } from 'react';
import { Badge, Button, Card, Icon, InfoTip, Stat } from '../components/ui';
import { ACHIEVEMENTS, STORE_ITEMS, emblemFor, earnedEmblemIds } from '../lib/catalog';
import { DAILY_FLASHCARD_COIN_CAP, DAILY_QUESTION_COIN_CAP } from '../lib/storage';
import { useApp } from '../lib/store';

export function RewardsPage() {
  const app = useApp();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const today = app.dailyActivity[app.dailyActivity.length - 1];
  const activeTheme = app.settings.activeTheme ?? null;
  const activeFlair = app.settings.activeFlair ?? null;
  const activeEmblem = emblemFor(activeFlair);
  const earnedEmblems = new Set(earnedEmblemIds(app.achievements, app.ownedItems));

  const handleBuy = async (itemId: string, cost: number, name: string) => {
    const res = await app.actions.purchase(itemId, cost);
    setFeedback(
      res.ok
        ? { ok: true, text: `Unlocked and applied ${name}.` }
        : { ok: false, text: res.reason ?? 'Could not complete purchase.' }
    );
  };

  const equipTheme = (itemId: string, name: string) => {
    const next = activeTheme === itemId ? null : itemId;
    app.actions.updateSettings({ activeTheme: next });
    setFeedback({
      ok: true,
      text: next ? `Applied ${name}.` : 'Restored default HDSAT Blue theme.',
    });
  };

  const equipEmblem = (achievementId: string, name: string) => {
    if (!earnedEmblems.has(achievementId)) return;
    const next = activeFlair === achievementId ? null : achievementId;
    app.actions.updateSettings({ activeFlair: next });
    setFeedback({ ok: true, text: next ? `${name} emblem equipped.` : 'Emblem removed.' });
  };

  return (
    <div>
      <Card>
        <div className="row-between">
          <div>
            <div className="row">
              <h1>Rewards</h1>
              <InfoTip label="Earning rules">
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                  <li>First attempt on a question: +1 HDCoin (once per question).</li>
                  <li>
                    First correct solution: +1 HDCoin (daily cap {DAILY_QUESTION_COIN_CAP}).
                  </li>
                  <li>
                    Due flashcard review: +1 HDCoin (up to {DAILY_FLASHCARD_COIN_CAP}/day).
                  </li>
                  <li>Streak milestone: +5 HDCoins once a day.</li>
                  <li>Full adaptive simulation: +25 HDCoins.</li>
                  <li>Achievements: +5 to +40 HDCoins each.</li>
                </ul>
              </InfoTip>
            </div>
          </div>
          <Badge tone="good">{app.hdCoins} HDCoins</Badge>
        </div>

        <div className="card-grid" style={{ marginTop: 12 }}>
          <Stat label="HDCoins" value={app.hdCoins} hint={`${today?.coinsEarned ?? 0} today`} />
          <Stat
            label="Study Streak"
            value={`${app.currentStreak} d`}
            hint={`Best ${app.bestStreak} d`}
          />
          <Stat label="Achievements" value={`${app.achievements.length} / ${ACHIEVEMENTS.length}`} />
          <Stat label="Theme" value={activeTheme ? STORE_ITEMS.find((i) => i.id === activeTheme)?.name.replace(/ Theme$/, '') ?? 'Custom' : 'HDSAT Blue'} />
        </div>
      </Card>

      {feedback ? (
        <Card>
          <p style={{ color: feedback.ok ? 'var(--good)' : 'var(--bad)', margin: 0 }}>
            {feedback.text}
          </p>
        </Card>
      ) : null}

      <div className="grid-2">
        <Card>
          <div className="row-between">
            <h2>Theme Store</h2>
            {activeTheme ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  app.actions.updateSettings({ activeTheme: null });
                  setFeedback({ ok: true, text: 'Restored default HDSAT Blue theme.' });
                }}
              >
                Default Blue
              </Button>
            ) : null}
          </div>
          <div className="stack" style={{ marginTop: 12 }}>
            {STORE_ITEMS.map((item) => {
              const owned = app.ownedItems.includes(item.id);
              const isActive = activeTheme === item.id;
              return (
                <div key={item.id} className="muted-block row-between">
                  <div>
                    <div className="row">
                      <span className={`theme-swatch theme-swatch-${item.id}`} />
                      <strong>{item.name}</strong>
                      {isActive ? <Badge tone="good">Active</Badge> : null}
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {item.description}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={isActive ? 'primary' : 'outline'}
                    icon={owned ? (isActive ? 'check' : 'palette') : 'coins'}
                    disabled={!owned && app.hdCoins < item.cost}
                    onClick={() =>
                      owned ? equipTheme(item.id, item.name) : void handleBuy(item.id, item.cost, item.name)
                    }
                  >
                    {owned ? (isActive ? 'Active' : 'Apply') : `Unlock ${item.cost}`}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <div className="row-between">
            <h2>Achievements</h2>
            {activeEmblem ? (
              <Button
                size="sm"
                variant="subtle"
                onClick={() => {
                  app.actions.updateSettings({ activeFlair: null });
                  setFeedback({ ok: true, text: 'Emblem removed.' });
                }}
              >
                <Icon name={activeEmblem.icon} size={13} />
                <span>{activeEmblem.name}</span>
              </Button>
            ) : null}
          </div>
          <p className="muted" style={{ marginTop: 4 }}>Each achievement earns its emblem.</p>
          <div className="stack" style={{ marginTop: 10 }}>
            {ACHIEVEMENTS.map((ach) => {
              const earned = app.achievements.includes(ach.id);
              const equipped = activeFlair === ach.id;
              return (
                <div key={ach.id} className="muted-block row-between">
                  <div>
                    <div className="row" style={{ gap: 8 }}>
                      <span className={`emblem-glyph${equipped ? ' is-active' : ''}`}>
                        <Icon name={ach.icon} size={14} />
                      </span>
                      <strong>{ach.name}</strong>
                      <Badge tone={earned ? 'good' : 'info'}>+{ach.rewardCoins}</Badge>
                    </div>
                    <div className="muted">{ach.description}</div>
                  </div>
                  <Button
                    size="sm"
                    variant={equipped ? 'primary' : 'outline'}
                    disabled={!earned}
                    onClick={() => equipEmblem(ach.id, ach.name)}
                  >
                    {equipped ? 'Equipped' : earned ? 'Wear' : 'Locked'}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
