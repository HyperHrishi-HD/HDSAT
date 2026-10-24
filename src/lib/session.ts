/**
 * A custom practice session that can survive a refresh, a closed tab or a
 * switch to another device tab. Only the student's own answers are stored
 * locally; the schedule and grading stay in the bank.
 */
export const PRACTICE_SESSION_KEY = 'hdsat.practice-session.v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PracticeFeedbackSnapshot {
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string;
  distractorRationales?: Record<string, string>;
}

export interface PracticeSessionSnapshot {
  version: 1;
  sessionId: string;
  questionIds: string[];
  index: number;
  responses: Record<string, string>;
  flagged: Record<string, boolean>;
  feedback: Record<string, PracticeFeedbackSnapshot>;
  elapsedSeconds: number;
  assessment: string;
  startedAt: string;
  updatedAt: string;
}

export interface PracticeResumeSummary {
  answered: number;
  total: number;
  index: number;
  elapsedSeconds: number;
  assessment: string;
  updatedAt: string;
  /** First unanswered item, 1-based; equals total when everything is answered. */
  nextNumber: number;
}

function storage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function savePracticeSession(snapshot: PracticeSessionSnapshot): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      PRACTICE_SESSION_KEY,
      JSON.stringify({ ...snapshot, updatedAt: new Date().toISOString() })
    );
  } catch {
    /* quota or private mode: resume is a convenience, never a requirement */
  }
}

export function clearPracticeSession(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(PRACTICE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function loadPracticeSession(now: number = Date.now()): PracticeSessionSnapshot | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(PRACTICE_SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PracticeSessionSnapshot>;
    if (!parsed || !Array.isArray(parsed.questionIds) || parsed.questionIds.length === 0) {
      clearPracticeSession();
      return null;
    }
    const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '';
    const updatedMs = new Date(updatedAt).getTime();
    if (!Number.isFinite(updatedMs) || now - updatedMs > MAX_AGE_MS) {
      clearPracticeSession();
      return null;
    }
    const questionIds = parsed.questionIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (questionIds.length === 0) {
      clearPracticeSession();
      return null;
    }
    const index = Number(parsed.index ?? 0);
    return {
      version: 1,
      sessionId: String(parsed.sessionId ?? ''),
      questionIds,
      index: Number.isFinite(index) ? Math.max(0, Math.min(questionIds.length - 1, Math.floor(index))) : 0,
      responses: parsed.responses ?? {},
      flagged: parsed.flagged ?? {},
      feedback: parsed.feedback ?? {},
      elapsedSeconds: Number(parsed.elapsedSeconds ?? 0) || 0,
      assessment: String(parsed.assessment ?? 'SAT'),
      startedAt: String(parsed.startedAt ?? updatedAt ?? new Date(now).toISOString()),
      updatedAt: updatedAt || new Date(now).toISOString(),
    };
  } catch {
    clearPracticeSession();
    return null;
  }
}

/** Everything the Dashboard strip needs, or null when there is nothing to resume. */
export function practiceResumeSummary(
  snapshot: PracticeSessionSnapshot | null
): PracticeResumeSummary | null {
  if (!snapshot) return null;
  const total = snapshot.questionIds.length;
  const answeredIds = new Set(
    Object.entries(snapshot.responses)
      .filter(([, value]) => Boolean(value && value.trim()))
      .map(([id]) => id)
  );
  const answered = snapshot.questionIds.filter((id) => answeredIds.has(id)).length;
  if (total === 0) return null;
  if (answered >= total && total > 0) return null;
  const nextIndex = snapshot.questionIds.findIndex((id) => !answeredIds.has(id));
  return {
    answered,
    total,
    index: snapshot.index,
    elapsedSeconds: snapshot.elapsedSeconds,
    assessment: snapshot.assessment,
    updatedAt: snapshot.updatedAt,
    nextNumber: (nextIndex >= 0 ? nextIndex : Math.min(snapshot.index, total - 1)) + 1,
  };
}
