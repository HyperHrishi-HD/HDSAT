import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QuestionView, type Feedback } from '../components/QuestionView';
import { Badge, Button, Card, EmptyState, Field, InfoTip, Select, Toggle } from '../components/ui';
import { filterQuestions } from '../lib/examEngine';
import { useApp } from '../lib/store';
import type { Assessment, Difficulty, Question, Section } from '../lib/types';

export function QuestionBankPage() {
  const app = useApp();
  const [searchParams] = useSearchParams();

  const [assessment, setAssessment] = useState<string>('all');
  const [section, setSection] = useState<Section | 'all'>('all');
  const [domain, setDomain] = useState<string>('all');
  const [difficulty, setDifficulty] = useState<Difficulty | 'all'>('all');
  const [sourceId, setSourceId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [onlySaved, setOnlySaved] = useState<boolean>(searchParams.get('saved') === '1');
  const [excludeReleased, setExcludeReleased] = useState<boolean>(app.settings.excludeReleasedPracticeSet);
  const [excludeCorrect, setExcludeCorrect] = useState<boolean>(false);

  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [eliminated, setEliminated] = useState<Record<string, string[]>>({});
  const [feedbackMap, setFeedbackMap] = useState<Record<string, Feedback>>({});

  // The catalog holds thousands of items. Rendering every row at once is what
  // made this page stall, so rows are revealed in pages instead.
  const PAGE_SIZE = 60;
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);

  const domains = useMemo(() => {
    const s = new Set<string>();
    app.questions.forEach((q) => {
      if (section === 'all' || q.section === section) s.add(q.domain);
    });
    return Array.from(s);
  }, [app.questions, section]);

  const filteredQuestions = useMemo(() => {
    const base = filterQuestions(
      app.questions,
      {
        assessment: assessment === 'all' ? undefined : (assessment as Assessment),
        section,
        domain,
        difficulty,
        sourceId,
        onlySaved,
        excludePreviouslyCorrect: excludeCorrect,
        excludeReleasedPracticeSet: excludeReleased,
      },
      app.progress,
      app.saved
    );

    const qLower = search.trim().toLowerCase();
    return base.filter((q) => {
      if (statusFilter !== 'all') {
        const st = app.progress[q.id]?.status ?? 'unseen';
        if (st !== statusFilter) return false;
      }
      if (!qLower) return true;
      return (
        q.id.toLowerCase().includes(qLower) ||
        q.domain.toLowerCase().includes(qLower) ||
        q.skill.toLowerCase().includes(qLower) ||
        q.prompt.toLowerCase().includes(qLower) ||
        (q.stimulus ?? '').toLowerCase().includes(qLower)
      );
    });
  }, [
    app.questions,
    app.progress,
    app.saved,
    assessment,
    section,
    domain,
    difficulty,
    sourceId,
    statusFilter,
    search,
    onlySaved,
    excludeCorrect,
    excludeReleased,
  ]);

  const hasFilters =
    assessment !== 'all' ||
    section !== 'all' ||
    domain !== 'all' ||
    difficulty !== 'all' ||
    sourceId !== 'all' ||
    statusFilter !== 'all' ||
    search.trim() !== '' ||
    onlySaved ||
    excludeCorrect;

  // A new filter starts a fresh page of results.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [
    assessment,
    section,
    domain,
    difficulty,
    sourceId,
    statusFilter,
    search,
    onlySaved,
    excludeCorrect,
    excludeReleased,
  ]);

  const visibleQuestions = useMemo(
    () => filteredQuestions.slice(0, visibleCount),
    [filteredQuestions, visibleCount]
  );

  const activeQuestion: Question | null = useMemo(() => {
    if (!selectedQuestionId) return filteredQuestions[0] ?? null;
    return filteredQuestions.find((q) => q.id === selectedQuestionId) ?? filteredQuestions[0] ?? null;
  }, [filteredQuestions, selectedQuestionId]);

  const handleCheck = async (q: Question) => {
    const given = responses[q.id] ?? '';
    if (!given.trim()) return;
    const res = await app.actions.submitAttempt(q, given, {
      mode: 'review',
      timeSpentSeconds: 15,
    });
    setFeedbackMap((prev) => ({
      ...prev,
      [q.id]: {
        isCorrect: res.isCorrect,
        correctAnswer: q.correct_answer,
        explanation: q.explanation,
        distractorRationales: q.distractor_rationales,
      },
    }));
  };

  return (
    <div>
      <Card>
        <div className="row-between">
          <div className="row">
            <h1>Question Bank</h1>
            <InfoTip label="Sources & licensing">
              <div className="stack" style={{ gap: 8 }}>
                <div>{app.licensingNote}</div>
                {app.sources.map((src) => (
                  <div key={src.source_id}>
                    <strong>{src.name}</strong> ({src.license}) — {src.record_count} items
                  </div>
                ))}
              </div>
            </InfoTip>
          </div>
          <Badge tone="info">
            {hasFilters ? `${filteredQuestions.length} matching` : `${app.questions.length} items`}
          </Badge>
        </div>

        <div className="card-grid" style={{ marginTop: 12 }}>
          <Field label="Search ID, skill, or text">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. RW-INF-001, quadratic, inference..."
            />
          </Field>
          <Select
            label="Assessment"
            value={assessment}
            onChange={setAssessment}
            options={[
              { value: 'all', label: 'All Assessments' },
              { value: 'SAT', label: 'Digital SAT' },
              { value: 'PSAT/NMSQT', label: 'PSAT/NMSQT' },
              { value: 'PSAT 10', label: 'PSAT 10' },
              { value: 'PSAT 8/9', label: 'PSAT 8/9' },
            ]}
          />
          <Select
            label="Section"
            value={section}
            onChange={(v) => {
              setSection(v as Section | 'all');
              setDomain('all');
            }}
            options={[
              { value: 'all', label: 'All Sections' },
              { value: 'Reading and Writing', label: 'Reading and Writing' },
              { value: 'Math', label: 'Math' },
            ]}
          />
          <Select
            label="Domain"
            value={domain}
            onChange={setDomain}
            options={[
              { value: 'all', label: 'All Domains' },
              ...domains.map((d) => ({ value: d, label: d })),
            ]}
          />
          <Select
            label="Difficulty"
            value={difficulty}
            onChange={(v) => setDifficulty(v as Difficulty | 'all')}
            options={[
              { value: 'all', label: 'All Difficulties' },
              { value: 'Easy', label: 'Easy' },
              { value: 'Medium', label: 'Medium' },
              { value: 'Hard', label: 'Hard' },
            ]}
          />
          <Select
            label="Mastery Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: 'Any Status' },
              { value: 'unseen', label: 'Unseen' },
              { value: 'incorrect', label: 'Incorrect' },
              { value: 'correct', label: 'Correct' },
              { value: 'mastered', label: 'Mastered (2+ in a row)' },
            ]}
          />
          <Select
            label="Dataset Source"
            value={sourceId}
            onChange={setSourceId}
            options={[
              { value: 'all', label: 'All Sources' },
              ...app.sources.map((s) => ({ value: s.source_id, label: `${s.name} (${s.record_count})` })),
            ]}
          />
        </div>

        <div className="row" style={{ gap: 20 }}>
          <Toggle
            checked={onlySaved}
            onChange={setOnlySaved}
            label="Saved only"
          />
          <Toggle
            checked={excludeCorrect}
            onChange={setExcludeCorrect}
            label="Hide previously correct"
          />
          <Toggle
            checked={excludeReleased}
            onChange={setExcludeReleased}
            label="Exclude Benchmark Simulation Set"
          />
        </div>
      </Card>

      {filteredQuestions.length === 0 ? (
        <Card>
          <EmptyState
            title="No matching questions"
            body="Adjust your search query or filters to view items in the HDSAT Question Bank."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setAssessment('all');
                  setSection('all');
                  setDomain('all');
                  setDifficulty('all');
                  setSourceId('all');
                  setStatusFilter('all');
                  setSearch('');
                  setOnlySaved(false);
                  setExcludeCorrect(false);
                  setExcludeReleased(false);
                }}
              >
                Reset all filters
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid-2">
          <Card>
            <h3>Catalog</h3>
            <div style={{ maxHeight: 580, overflowY: 'auto', marginTop: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Domain / Skill</th>
                    <th>Diff</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQuestions.map((q) => {
                    const st = app.progress[q.id]?.status ?? 'unseen';
                    const isSaved = app.saved.includes(q.id);
                    const isSelected = activeQuestion?.id === q.id;
                    return (
                      <tr
                        key={q.id}
                        style={{
                          cursor: 'pointer',
                          background: isSelected ? 'var(--surface-2)' : undefined,
                        }}
                        onClick={() => setSelectedQuestionId(q.id)}
                      >
                        <td className="mono">
                          <strong>{q.id}</strong> {isSaved ? '★' : ''}
                        </td>
                        <td>
                          <div>{q.domain}</div>
                          <div className="muted">{q.skill}</div>
                        </td>
                        <td>
                          <Badge
                            tone={q.difficulty === 'Hard' ? 'bad' : q.difficulty === 'Medium' ? 'warn' : 'good'}
                          >
                            {q.difficulty}
                          </Badge>
                        </td>
                        <td>
                          <Badge
                            tone={
                              st === 'mastered' || st === 'correct'
                                ? 'good'
                                : st === 'incorrect'
                                ? 'bad'
                                : 'neutral'
                            }
                          >
                            {st}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {visibleCount < filteredQuestions.length ? (
              <div className="row" style={{ marginTop: 10, justifyContent: 'center' }}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                >
                  Show more
                </Button>
              </div>
            ) : null}
          </Card>

          <div>
            {activeQuestion ? (
              <div>
                <div className="row-between" style={{ marginBottom: 8 }}>
                  <div className="row">
                    <strong className="mono">{activeQuestion.id}</strong>
                    <Badge>{activeQuestion.assessments.join(', ')}</Badge>
                  </div>
                  <div className="row">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => app.actions.toggleSaved(activeQuestion.id)}
                    >
                      {app.saved.includes(activeQuestion.id) ? 'Saved ★' : 'Bookmark ☆'}
                    </Button>
                    {feedbackMap[activeQuestion.id] ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setFeedbackMap((prev) => {
                            const copy = { ...prev };
                            delete copy[activeQuestion.id];
                            return copy;
                          });
                          setResponses((prev) => ({ ...prev, [activeQuestion.id]: '' }));
                        }}
                      >
                        Retry item
                      </Button>
                    ) : null}
                  </div>
                </div>

                <QuestionView
                  question={activeQuestion}
                  index={filteredQuestions.findIndex((q) => q.id === activeQuestion.id)}
                  total={hasFilters ? filteredQuestions.length : undefined}
                  response={responses[activeQuestion.id] ?? null}
                  onResponseChange={(val) =>
                    setResponses((prev) => ({
                      ...prev,
                      [activeQuestion.id]: val,
                    }))
                  }
                  eliminated={eliminated[activeQuestion.id] ?? []}
                  onToggleEliminate={(choiceId) =>
                    setEliminated((prev) => {
                      const list = prev[activeQuestion.id] ?? [];
                      const next = list.includes(choiceId)
                        ? list.filter((c) => c !== choiceId)
                        : [...list, choiceId];
                      return { ...prev, [activeQuestion.id]: next };
                    })
                  }
                  feedback={feedbackMap[activeQuestion.id] ?? null}
                  onSubmit={() => handleCheck(activeQuestion)}
                  disabled={Boolean(feedbackMap[activeQuestion.id])}
                />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
