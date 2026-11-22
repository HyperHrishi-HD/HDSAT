import { useMemo, useRef, useState } from 'react';
import { FigureView, StimulusView } from './FigureView';
import { MathText } from './MathText';
import { Badge, Button, Card, Icon, ProgressBar } from './ui';
import {
  DAILY_QUESTS,
  DAILY_QUEST_QUESTION_CAP,
  QUEST_MATH_COUNT,
  QUEST_RW_COUNT,
  loadQuestState,
  questFocus,
  questQuestionIds,
  questUserKey,
  saveQuestProgress,
  type QuestDefinition,
  type QuestState,
} from '../lib/daily';
import { newEventId, todayKey } from '../lib/storage';
import { useApp } from '../lib/store';
import type { Question } from '../lib/types';

/**
 * Three daily quests, five R&W plus five Math each. Thirty questions is the
 * whole arcade allowance for the day, so the quests cannot run away with a
 * student's session — or with the coin economy.
 */
export function DailyQuests() {
  const app = useApp();
  const [state, setState] = useState<QuestState>(() => loadQuestState());
  const [activeQuest, setActiveQuest] = useState<QuestDefinition | null>(null);
  const [response, setResponse] = useState('');
  const [feedback, setFeedback] = useState<{ correct: boolean; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<string>(newEventId());
  const date = todayKey();
  const seed = questUserKey(app.user?.id);

  const byId = useMemo(() => {
    const map = new Map<string, Question>();
    app.questions.forEach((q) => map.set(q.id, q));
    return map;
  }, [app.questions]);

  // Built from this student's own history, so the three quests differ for every
  // account and follow what they actually need that day.
  const focus = useMemo(
    () => questFocus(app.questions, app.progress, { testDate: app.settings.testDate }),
    [app.questions, app.progress, app.settings.testDate]
  );

  const questQuestions = (questId: string): Question[] =>
    questQuestionIds(app.questions, questId, app.settings.assessment, date, app.progress, {
      seed,
      testDate: app.settings.testDate,
    })
      .map((id) => byId.get(id))
      .filter((q): q is Question => Boolean(q));

  /** One short line saying why today's draw looks the way it does. */
  const reason = (questId: string): string => {
    const weak = focus.weakDomains.slice(0, 2).join(' · ');
    if (questId === 'precision') {
      return weak ? `Your weakest areas: ${weak}.` : 'Mixed items at your current level.';
    }
    if (questId === 'gauntlet') {
      if (focus.daysToTest !== null && focus.daysToTest <= 10) {
        return `${focus.daysToTest} day${focus.daysToTest === 1 ? '' : 's'} to your test — hardest items first.`;
      }
      return weak ? `Hard items, weighted to ${weak}.` : 'The hardest items first.';
    }
    return weak ? `A mixed set, leaning on ${weak}.` : 'A mixed set to open the day.';
  };

  const answeredToday = useMemo(
    () =>
      DAILY_QUESTS.reduce((sum, quest) => sum + (state[quest.id]?.answered.length ?? 0), 0),
    [state]
  );

  const begin = (quest: QuestDefinition) => {
    sessionRef.current = newEventId();
    setActiveQuest(quest);
    setResponse('');
    setFeedback(null);
  };

  if (!activeQuest) {
    return (
      <Card>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <div className="row">
            <Icon name="flame" size={16} />
            <h2 style={{ margin: 0 }}>Daily Quests</h2>
          </div>
          <Badge tone={answeredToday >= DAILY_QUEST_QUESTION_CAP ? 'good' : 'info'}>
            {answeredToday} / {DAILY_QUEST_QUESTION_CAP} questions today
          </Badge>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          {QUEST_RW_COUNT} Reading &amp; Writing + {QUEST_MATH_COUNT} Math per quest · resets at midnight.
        </p>

        <div className="stack">
          {DAILY_QUESTS.map((quest) => {
            const progress = state[quest.id];
            const answered = progress?.answered.length ?? 0;
            const total = questQuestions(quest.id).length || QUEST_RW_COUNT + QUEST_MATH_COUNT;
            const complete = Boolean(progress?.completedAt) || (total > 0 && answered >= total);
            return (
              <div key={quest.id} className="muted-block quest-row">
                <div className="quest-row-main">
                  <div className="row-between">
                    <strong>
                      <Icon name={quest.icon} size={13} /> {quest.name}
                    </strong>
                    {complete ? (
                      <Badge tone="good">Complete</Badge>
                    ) : (
                      <Badge tone="neutral">
                        {answered}/{total}
                      </Badge>
                    )}
                  </div>
                  <p className="muted" style={{ margin: '2px 0 8px' }}>
                    {reason(quest.id)}
                  </p>
                  <ProgressBar value={answered} max={Math.max(1, total)} />
                </div>
                <Button
                  size="sm"
                  variant={complete ? 'outline' : 'primary'}
                  disabled={complete || answeredToday >= DAILY_QUEST_QUESTION_CAP}
                  onClick={() => begin(quest)}
                >
                  {complete ? 'Done today' : answered > 0 ? 'Continue' : 'Start quest'}
                </Button>
              </div>
            );
          })}
        </div>
      </Card>
    );
  }

  const questions = questQuestions(activeQuest.id);
  const progress = state[activeQuest.id] ?? { answered: [], correct: 0, completedAt: null };
  const current = questions.find((q) => !progress.answered.includes(q.id)) ?? null;

  const finish = () => {
    setActiveQuest(null);
    setFeedback(null);
    setResponse('');
  };

  if (!current) {
    return (
      <Card>
        <div className="row-between">
          <h2 style={{ margin: 0 }}>{activeQuest.name} complete</h2>
          <Badge tone="good">Quest finished</Badge>
        </div>
        <p className="muted">
          {progress.correct} of {progress.answered.length} correct. A fresh set arrives tomorrow.
        </p>
        <Button onClick={finish}>Back to all quests</Button>
      </Card>
    );
  }

  const submit = async (value: string) => {
    const answer = value.trim();
    if (!answer || busy) return;
    setBusy(true);
    try {
      const result = await app.actions.submitAttempt(current, answer, {
        mode: 'game',
        sessionId: sessionRef.current,
      });
      const nextState = saveQuestProgress(activeQuest.id, (prev) => {
        const answered = prev.answered.includes(current.id)
          ? prev.answered
          : [...prev.answered, current.id];
        const correct = prev.correct + (result.isCorrect ? 1 : 0);
        const isLast = answered.length >= questions.length;
        const completedAt = isLast ? new Date().toISOString() : prev.completedAt;
        if (isLast && !prev.completedAt) {
          // One reward per quest per day, recorded through the same session path
          // the cloud uses (a 5–50 HDCoin roll, five rewarded game sessions a day).
          void app.actions.completeSession({
            activityType: 'mini_game',
            sessionId: `${sessionRef.current}:${activeQuest.id}`,
            questions: answered.length,
            correct,
            timeSpentSeconds: 0,
          });
        }
        return { answered, correct, completedAt };
      });
      // Keep every quest on the same day ledger, not just the active one.
      setState({ ...nextState });
      setFeedback({ correct: result.isCorrect, key: current.correct_answer });
      setResponse('');
    } finally {
      setBusy(false);
    }
  };

  const questionNumber = progress.answered.length + 1;

  return (
    <Card>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>{activeQuest.name}</h2>
          <p className="muted" style={{ margin: '2px 0 0' }}>
            Question {questionNumber} of {questions.length} · {progress.correct} correct so far
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={finish}>
          Pause quest
        </Button>
      </div>

      <FigureView question={current} />
      {current.stimulus ? (
        <div className="stimulus">
          <StimulusView stimulus={current.stimulus} />
        </div>
      ) : null}
      <div className="prompt">
        <MathText text={current.prompt} />
      </div>

      {feedback ? (
        <p className="muted">
          Previous item:{' '}
          <strong style={{ color: feedback.correct ? 'var(--good)' : 'var(--bad)' }}>
            {feedback.correct ? 'Correct!' : `Incorrect (Key: ${feedback.key})`}
          </strong>
        </p>
      ) : null}

      {current.format === 'multiple_choice' && current.choices ? (
        <div>
          {current.choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className="rush-option"
              disabled={busy}
              onClick={() => void submit(choice.id)}
            >
              <strong>{choice.id}.</strong> <MathText text={choice.text} />
            </button>
          ))}
        </div>
      ) : (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(response);
          }}
        >
          <input
            type="text"
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Enter your answer"
          />
          <Button type="submit" disabled={busy || !response.trim()}>
            Submit
          </Button>
        </form>
      )}
    </Card>
  );
}
