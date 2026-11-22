import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FloatingToolWindow } from '../components/FloatingToolWindow';
import { DesmosFrame } from '../components/MathTools';
import { ReferenceWindow } from '../components/ReferenceWindow';
import { QuestionView, type Feedback } from '../components/QuestionView';
import { Badge, Button, Card, EmptyState, Field, Icon, InfoTip, Select, Toggle } from '../components/ui';
import { datasetLabel } from '../lib/catalog';
import { filterQuestions, templateMasteryIds } from '../lib/examEngine';
import { useApp } from '../lib/store';
import type { Assessment, Difficulty, Question, Section } from '../lib/types';

export function QuestionBankPage() {
  const app = useApp();
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedDomain = searchParams.get('domain')?.trim() ?? '';
  const requestedSection = searchParams.get('section')?.trim() ?? '';
  const initialSection: Section | 'all' =
    requestedSection === 'Math' || requestedSection === 'Reading and Writing'
      ? requestedSection
      : 'all';
  const [assessment, setAssessment] = useState<string>('all');
  const [section, setSection] = useState<Section | 'all'>(initialSection);
  const [domain, setDomain] = useState<string>(requestedDomain || 'all');
  const [difficulty, setDifficulty] = useState<Difficulty | 'all'>('all');
  const [sourceId, setSourceId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const savedParam = searchParams.get('saved');
  const [onlySaved, setOnlySaved] = useState<boolean>(savedParam === '1');
  const [excludeReleased, setExcludeReleased] = useState<boolean>(app.settings.excludeReleasedPracticeSet);
  const [excludeCorrect, setExcludeCorrect] = useState<boolean>(
    app.settings.excludePreviouslyCorrect
  );

  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [showCalc, setShowCalc] = useState<boolean>(false);
  const [showRef, setShowRef] = useState<boolean>(false);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [eliminated, setEliminated] = useState<Record<string, string[]>>({});
  const [feedbackMap, setFeedbackMap] = useState<Record<string, Feedback>>({});

  // The catalog holds thousands of items. Rendering every row at once is what
  // made this page stall, so rows are revealed in pages instead.
  const PAGE_SIZE = 60;
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);

  // Keep the URL in step with the switch, so a refresh or a copied link shows
  // the same view instead of restoring a stale saved-only filter.
  const applySavedOnly = (next: boolean) => {
    setOnlySaved(next);
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next) params.set('saved', '1');
        else params.delete('saved');
        return params;
      },
      { replace: true }
    );
  };

  // The Dashboard's "View saved" link lands here with ?saved=1. Reading it once
  // at mount is not enough when the query changes without a remount, so keep the
  // toggle in step with the link. Manual changes go through applySavedOnly.
  useEffect(() => {
    setOnlySaved(savedParam === '1');
  }, [savedParam]);

  useEffect(() => {
    if (!requestedDomain) {
      setDomain('all');
      return;
    }
    const match = app.questions.find((q) => q.domain === requestedDomain);
    setDomain(requestedDomain);
    if (match) setSection(match.section);
  }, [requestedDomain, app.questions]);

  useEffect(() => {
    if (requestedDomain) return;
    if (requestedSection === 'Math' || requestedSection === 'Reading and Writing') {
      setSection(requestedSection);
      setDomain('all');
      return;
    }
    if (!requestedSection) setSection('all');
  }, [requestedDomain, requestedSection]);

  const domains = useMemo(() => {
    const s = new Set<string>();
    app.questions.forEach((q) => {
      if (section === 'all' || q.section === section) s.add(q.domain);
    });
    return Array.from(s);
  }, [app.questions, section]);

  // A mastered template masters its siblings in the catalog (see
  // templateMasteryIds). Built once per progress change, not per row.
  const templateMastered = useMemo(
    () => templateMasteryIds(app.questions, app.progress),
    [app.questions, app.progress]
  );
  const statusOf = (id: string) =>
    templateMastered.has(id) ? 'mastered' : app.progress[id]?.status ?? 'unseen';

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
        const st = templateMastered.has(q.id) ? 'mastered' : app.progress[q.id]?.status ?? 'unseen';
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
    templateMastered,
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
    excludeCorrect ||
    excludeReleased;
  const showsWholeBank =
    app.questions.length > 0 && filteredQuestions.length === app.questions.length;

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
                    <strong>{datasetLabel(src)}</strong>
                    {src.license_url ? (
                      <>
                        {' '}
                        <a href={src.license_url} target="_blank" rel="noreferrer">
                          {src.license}
                        </a>
                      </>
                    ) : (
                      <> {src.license}</>
                    )}
                  </div>
                ))}
              </div>
            </InfoTip>
          </div>
          <Badge tone="info">
            {showsWholeBank
              ? `${app.questions.length.toLocaleString()} items`
              : hasFilters
              ? `${filteredQuestions.length.toLocaleString()} of ${app.questions.length.toLocaleString()} items`
              : `${filteredQuestions.length.toLocaleString()} items`}
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
              ...app.sources.map((s) => ({ value: s.source_id, label: datasetLabel(s) })),
            ]}
          />
        </div>

        <div className="row" style={{ gap: 20 }}>
          <Toggle
            checked={onlySaved}
            onChange={applySavedOnly}
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
            title={onlySaved ? 'No saved questions yet' : 'No matching questions'}
            body={
              onlySaved
                ? 'The Saved only switch is on. Use Bookmark on any question and it appears here.'
                : 'Adjust your search query or filters to view items in the HDSAT Question Bank.'
            }
            action={
              onlySaved ? (
                <Button variant="outline" onClick={() => applySavedOnly(false)}>
                  Show all questions
                </Button>
              ) : (
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
                    applySavedOnly(false);
                    setExcludeCorrect(false);
                    setExcludeReleased(false);
                  }}
                >
                  Reset all filters
                </Button>
              )
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
                    const st = statusOf(q.id);
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
                          <strong>{q.id}</strong>{' '}
                          {isSaved ? <Icon name="bookmark" size={11} /> : null}
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
                    {/* Calculator and Reference Sheet are Math tools. Offering
                        the reference on a Reading & Writing item was a bug:
                        the real test does not. */}
                    {activeQuestion.section === 'Math' ? (
                      <>
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={() => setShowCalc((v) => !v)}
                        >
                          {showCalc ? 'Hide Calculator' : 'Calculator'}
                        </Button>
                        <Button size="sm" variant="subtle" onClick={() => setShowRef((v) => !v)}>
                          {showRef ? 'Hide Reference' : 'Reference Sheet'}
                        </Button>
                      </>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      icon="bookmark"
                      onClick={() => app.actions.toggleSaved(activeQuestion.id)}
                    >
                      {app.saved.includes(activeQuestion.id) ? 'Saved' : 'Bookmark'}
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

                {showRef && activeQuestion.section === 'Math' ? (
                  <ReferenceWindow
                    assessment={activeQuestion.assessments[0]}
                    onClose={() => setShowRef(false)}
                  />
                ) : null}

                {showCalc && activeQuestion.section === 'Math' ? (
                  <FloatingToolWindow
                    title="Desmos Graphing Calculator"
                    onClose={() => setShowCalc(false)}
                    storageKey="hdsat.window.bank-calc"
                    defaultWidth={560}
                    defaultHeight={520}
                    placement="bottom"
                    minWidth={280}
                    minHeight={260}
                    bodyClassName="bb-calc-window-body"
                    testId="bank-calculator-window"
                  >
                    <DesmosFrame />
                  </FloatingToolWindow>
                ) : null}

                <QuestionView
                  question={activeQuestion}
                  index={filteredQuestions.findIndex((q) => q.id === activeQuestion.id)}
                  total={filteredQuestions.length}
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
                  onNext={() => {
                    const currIdx = filteredQuestions.findIndex((q) => q.id === activeQuestion.id);
                    if (currIdx >= 0 && currIdx + 1 < filteredQuestions.length) {
                      setSelectedQuestionId(filteredQuestions[currIdx + 1].id);
                      if (currIdx + 1 >= visibleCount) {
                        setVisibleCount((prev) => prev + PAGE_SIZE);
                      }
                    }
                  }}
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
