import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StimulusView } from './FigureView';
import { GameShell } from './GameShell';
import { MathText } from './MathText';
import { Badge, Button, Card, Icon, Stat } from './ui';
import { buildChatPool, type ChatItem } from '../lib/arcadeGames';
import { newEventId } from '../lib/storage';
import { useApp } from '../lib/store';

/**
 * Table Talk — the Arcade's conversation game.
 *
 * Hrishi is working through a stack of Reading & Writing items at a late-night
 * table. Each item arrives as a passage she slides across the table, and the
 * student answers by picking a reply. She reacts in character, with a large
 * pool of replies so the same line rarely comes twice, and her portrait
 * animates (blinks, talks while she is "typing", breathes) without any image
 * assets.
 *
 * Eight exchanges per sitting keeps it a game rather than a drill; the reward
 * goes through the same capped mini-game session the rest of the Arcade uses.
 */

type Speaker = 'hrishi' | 'you';

interface Bubble {
  id: number;
  from: Speaker;
  text: string;
  tone?: 'good' | 'bad';
}

const CONVERSATION_LENGTH = 8;

const CORRECT_REPLIES = [
  "That's the one.",
  "Exactly — that's the line I'd mark.",
  'Yes. You caught the shift in the sentence.',
  "Clean read. I'd change nothing.",
  "Right. Not the obvious choice, which is why it's worth points.",
  "That's it. The clue was earlier in the sentence than it looked.",
  "Correct. You're reading like the test writer already.",
  'Yep. The other three all overreach.',
  "That's the answer I had circled too.",
  "Good. Notice how the sentence's second half decided it.",
  "Right again — say it back to me: why that one?",
  "Yes. You didn't take the bait on the near-miss.",
  "Exactly. That's a 700-level habit.",
  "Mm-hm. Keep that pace and you'll finish the module early.",
  'Correct. The contrast in the middle is doing all the work.',
  "That's the one. I'd write that explanation on a sticky note.",
  'Mm. That is what the punctuation was for.',
  "Yes — and you kept the scope. That's the hard part.",
  "Right. Most people pick the longer one out of nerves.",
  'True to the text. Not to your memory of the topic — to the text.',
  "That's it. Notice you needed the whole sentence, not just the blank.",
  'Clean. Add that one to the pile of things you no longer have to think about.',
  'Yes. The qualifier in the first clause rules out two of the others.',
  'Correct, and fast. If it feels easy, that usually means it is.',
  "That's the one — the transition was setting you up for it.",
  'Right. The passage says less than the wrong answers promise.',
  'Yes. You matched the tone as well as the meaning.',
  "Correct. I'd have taken the bait on that one at your age.",
  'That lands. The pronoun reference was the whole trick.',
  'Mm-hm. Precision beats speed, and you just did both.',
  "Exactly. Which means the next one is going to be worse.",
  "Good. That's three in a row and I am now suspicious of you.",
  'Yes — you read the graph, not the paragraph. Important distinction.',
  "That's it. I'll mark my own copy before I forget.",
  "Correct. That's the sort of answer that looks obvious once you're told.",
  'Good. That is the sentence doing its work, and you let it.',
  'Yes. And you resisted the urge to explain it, which is discipline.',
  'Right. Two clues, one answer, and you found both.',
  'Correct. That choice is boring, which is usually a good sign.',
  "That's it. I'd have gone back and forth on that one.",
  'Yes. You kept the passage and the question separate. Most people blend them.',
  'Clean. Notice the wrong ones all sound more interesting.',
  "That's the one. The examples were consistent and you trusted them.",
  'Correct. And you did it without needing the last sentence.',
  'Yes. That is the kind of answer that gets marked right and remembered.',
  'Right. You read it as a writer, not as a reader.',
  'Mm-hm. The comma was load-bearing and you noticed.',
  'Correct. The sentence was doing two jobs and you kept both.',
  "That's it. That is the difference between a 600 and a 700 answer.",
  'Yes. The answer is shorter than the passage, and that is fine.',
  'Good. You matched the register. People forget register.',
  "Correct. I'd have picked the trap. I usually do.",
  'Yes. The evidence was thin and you took only what it supported.',
  'Right. That is a choice you can defend in one sentence.',
  "That's it. The transition was doing the whole job.",
  'Correct. And no outside knowledge. That is the discipline.',
  'Yes. You stayed inside the paragraph.',
  'Right. The pronoun had exactly one referent and you found it.',
  'Mm. That is the answer the writer wanted, and they hid it well.',
  "That's the one. Which other option did you nearly take?",
  'Good. Three in a row. I am going to start timing you.',
  'Correct. That took half the time it should have.',
  'Yes. You noticed the word that changed the whole clause.',
  "That's it. That is the sort of sentence I rewrite twice and still get wrong.",
  'Right. The graph agreed with the sentence, and you checked both.',
  'Yes. You did not over-read. That is rarer than it sounds.',
  'Correct. The dash was a parenthesis and you treated it as one.',
  "That's the one. Keep that instinct; it will not always be this clear.",
  'Good. You read past the first plausible sentence. That is the whole skill.',
  'Yes. The word fits the sentence and the paragraph.',
  'Right. Now tell me why the other three were written to sound right.',
  'Correct. I would like to know how long that took you.',
  'Yes. That was a 700-level item and you made it look routine.',
  "That's it. And the explanation is one line, which is the sign of a clean answer.",
  'Mm-hm. You kept the scope of the claim exactly where the text left it.',
  'Correct. You read the clause boundary. Nobody reads the clause boundary.',
  'Yes. That is two items in a row where you beat the trap.',
  "That's the one. Hand it back; I'll put it in the good pile.",
  'Right. The evidence was in the last place you looked, which is normal.',
  'Good. That settles it. Next.',
];

const WRONG_REPLIES = [
  'Not quite — but I see why. Read the sentence before the blank again.',
  'Close. Two of these feel right; only one is earned by the text.',
  'Hmm. What in the passage actually says that?',
  "No — that's the trap answer. It sounds smart and says less.",
  "Not this one. Go back to the sentence's contrast.",
  'Almost. The right answer is narrower than the one you picked.',
  'That choice adds something the passage never claims.',
  'Wrong, but useful: now you know what the test wants you to assume.',
  'Not quite. Say the sentence with your choice in it out loud; it wobbles.',
  'No. Check who the sentence says did it.',
  "Ah — that's the near-miss. Look at the verb.",
  'Not that one. The colon is telling you a definition is coming.',
  'Missed it. The key phrase is a few words earlier than you looked.',
  'Nope. That option repeats a word from the passage but changes the job it does.',
  'Not this time. Rewrite the sentence in your own words first.',
  "That one's plausible and wrong — which is the most expensive kind.",
  'Almost. You matched the topic and missed the claim.',
  'No — and I will tell you why quietly: it contradicts the second sentence.',
  "That's too strong. The passage hedges and your answer does not.",
  'Not it. Read the choices as answers to the question asked, not to the passage.',
  "Wrong, but you're arguing with the right sentence. Stay there.",
  'Hmm. Which word in the passage would have to disappear for that to be true?',
  'Nope. That one would need the author to say something they avoided saying.',
  "That's the answer a careful reader picks when they're tired.",
  'No. The graph shows the trend, but not the number you chose.',
  "Almost — you dropped the negation. Everyone does that once a section.",
  'Missed it. The examples all point one way and your choice points the other.',
  "That's the near-miss again. Two words make all the difference here.",
  'Not quite. Try substituting it back and reading the whole sentence as a sentence.',
  "Wrong. But notice you ruled out the right one first — that's the habit to fix.",
  'No. The right answer needs no outside knowledge at all.',
  'Nope. That comma changes what the phrase attaches to.',
  'Not this one. You are reading the topic; the question asks about the function.',
  "Close, and I'd bet you knew it. Look at the tense.",
  'Wrong. Keep the sentence the same length as the blank demands.',
  "That's the trap with the familiar word in it. Familiar is not correct.",
  'No. Read the sentence again with your choice in it. It argues with itself.',
  'Not that one. You matched the tone and missed the meaning.',
  'Hmm. Which sentence would you point at to defend that?',
  'Almost. That is the answer to a slightly different question.',
  'No. The passage says one thing; your choice says a bigger thing.',
  'Not it. That option is true in general and false here.',
  'Wrong. Look at the subject again. It is not the one you are thinking of.',
  "Hmm. That choice repeats the passage's words and drops its point.",
  'No. The contrast is between two things and your answer picks neither.',
  'Close. Read the sentence after the blank. It usually settles these.',
  'Not quite. That is what the paragraph is about, not what the question asks.',
  'Wrong. The qualifier you ignored is doing the work.',
  'Nope. That is the answer if you stop reading at the comma.',
  'Almost, but the passage never claims it, and the test is strict about that.',
  'No. Check the tense of the verb before the blank.',
  'Not this one. You are answering from memory, not from the sentence.',
  'Hmm. That one is grammatically fine and logically wrong.',
  'Wrong. One word in the passage would have made that true, and it is not there.',
  'No. Two of those are plausible. You picked the third.',
  'Not quite. Try reading only the sentence before the blank.',
  'That is the distractor they wrote for people in a hurry.',
  'No. The passage supports less than that, and you added the rest.',
  'Wrong. Look at what the pronoun has to refer to. Nothing else fits.',
  'Hmm. That answer would need a sentence the author cut.',
  'Not it. You have the right paragraph and the wrong clause.',
  'No. The graph and the sentence disagree with your choice.',
  'Almost. The second half of the sentence contradicts you.',
  'Wrong. That is the opposite of what the transition signals.',
  'Nope. The answer is simpler than that, and simpler is usually right here.',
  'Not this time. You have read the topic sentence and stopped.',
  'No. That choice is true, but not supported by this passage.',
  'Wrong. The examples contradict it.',
  'Hmm. There are two clues and your answer uses neither.',
  'Not quite. Say what the sentence is doing before you pick.',
  'No. That one changes the meaning of the sentence to fit itself.',
  'Wrong. The answer needs to fit the paragraph, not just the blank.',
  'Almost. You were one word off, and one word is the whole item.',
  'Not that one. The dash was there to explain, not to add a new idea.',
  'No. Read the last sentence again; it narrows the answer considerably.',
  'Wrong. And I know why you picked it. So does the test writer.',
  'Nope. That is the answer that sounds like the passage. It is not the passage.',
  'Not quite. Find the sentence the question is actually quoting.',
  'No. That choice is too broad and the passage is carefully narrow.',
  'Hmm. Cross out the two you know are wrong and tell me what is left.',
  'Wrong. But read it again before I explain; you may catch it yourself.',
];

const GREETINGS = [
  "You made it. I saved you the seat by the window — the lamp there is the only one that works.",
  'Sit. I have eight items left in this stack and I refuse to do them alone.',
  "It's raining sideways and the coffee is terrible. Perfect conditions for a reading section.",
  "Right on time. My brain stopped at item four, so you're finishing the set with me.",
  "There you are. The librarian gave me a look, so we have to be quiet and fast.",
  'Good, you came back. Sit — I ordered you something and it is already cold.',
  "I found this stack in the back of the cupboard. Honestly it's the best thing that's happened today.",
  "Late again. Don't apologise, just take the first card.",
  "The power flickered twice and I nearly lost my place. Read fast.",
  "You look like someone who has done homework today. That is exactly what I need.",
  "Figured we would do this properly tonight. Eight items, then we go home.",
  "I have been sitting here since six. Please tell me you are ready.",
  'You are late, the tea is cold, and I have nine items. Sit down.',
  'Good. I was about to start without you and that never ends well.',
  'The heating is broken so keep your coat on. Reading section in the cold.',
  'There you are. I have been arguing with item three for twenty minutes.',
  'Sit. I found the answer key and then lost it again, so we do this properly.',
  'You came. I owe you a coffee and eight questions. In that order.',
  'Quiet tonight. Good. Nobody will interrupt us.',
  'I moved us to the corner table. The lamp is better and the chair is worse.',
  'Right. Notebook open. If I say something useful, write it down.',
  'Evening. My plan is eight items and then an argument about one of them.',
];

const OPENERS = [
  'Try this one.',
  "Here's the next. Take your time.",
  'This one is sneakier than it looks.',
  'Read the whole sentence before you answer.',
  "Your turn. I'll wait.",
  'Next card. The clue is in there, I promise.',
  'Okay, this one earns its difficulty.',
  'Last stretch — stay precise.',
  'This one has a trap in it and I am not telling you where.',
  'Slide it over. Tell me what the sentence is doing.',
  "Here. I got this one wrong twice, so don't rush it.",
  'Read the choices before the passage. See if it changes anything.',
  'This one rewards patience. The other eight rewarded speed.',
  'Okay. Blank in the middle, so the whole sentence matters.',
  "Go on then. I'll write down whatever you say.",
  'Two of these are close. One is earned.',
  'This is the kind of item people skip. Do not skip it.',
  'Next one. This is the sort they put late in a module.',
  'Here. Read the question before the passage this time.',
  'Try this. It looks like a grammar item and it is not.',
  'Your turn. I want the reason, not just the letter.',
  'This one has two answers that survive a first read.',
  'Okay. Look at the sentence, then look at me.',
  'Read it twice. The second read is where the answer is.',
  'This one is short and mean. Go.',
  'Take it. Tell me what the writer is doing.',
  'New card. If you get this, I will stop doubting you.',
  'Here, and read the whole paragraph, not the sentence with the blank.',
  'This is the last easy one. Everything after it is work.',
];

export function ChatQuest() {
  const app = useApp();
  const [seed, setSeed] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [log, setLog] = useState<Bubble[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [done, setDone] = useState(false);
  const bubbleId = useRef(0);
  const timers = useRef<number[]>([]);
  const sessionRef = useRef(newEventId());
  const startedRef = useRef(0);
  const awardedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastReplyRef = useRef('');
  // Frozen when the game opens: the pool must not re-draw mid-conversation just
  // because answering a card changed the progress map.
  const [progressAtStart] = useState(() => app.progress);

  // Hrishi never repeats herself back to back: the pool is large, and the seed
  // walks through it rather than cycling the same index every time.
  const chooseReply = (list: string[], seed: number) => {
    const size = list.length;
    let index = Math.abs(Math.round(seed)) % size;
    if (list[index] === lastReplyRef.current) index = (index + 1 + (size % 3)) % size;
    lastReplyRef.current = list[index];
    return list[index];
  };

  const pool: ChatItem[] = useMemo(
    () => (seed ? buildChatPool(app.questions, seed, CONVERSATION_LENGTH, progressAtStart) : []),
    [app.questions, seed, progressAtStart]
  );
  const current = pool[index] ?? null;

  const push = useCallback((from: Speaker, text: string, tone?: 'good' | 'bad') => {
    bubbleId.current += 1;
    setLog((prev) => [...prev, { id: bubbleId.current, from, text, tone }]);
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    },
    []
  );

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [log, typing, index]);

  const begin = () => {
    const nextSeed = `talk:${Date.now()}`;
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    setSeed(nextSeed);
    setIndex(0);
    setLog([]);
    bubbleId.current = 0;
    setChosen(null);
    setTyping(false);
    setBusy(false);
    setAwaitingNext(false);
    setCorrect(0);
    setAnswered(0);
    setStreak(0);
    setBestStreak(0);
    setDone(false);
    awardedRef.current = false;
    sessionRef.current = newEventId();
    startedRef.current = Date.now();
    later(() => push('hrishi', GREETINGS[Math.floor(Math.random() * GREETINGS.length)]), 120);
    later(() => push('hrishi', OPENERS[0]), 900);
  };

  const advanceTurn = (nextAnswered: number, nextCorrect: number) => {
    setChosen(null);
    setBusy(false);
    setAwaitingNext(false);
    if (nextAnswered >= CONVERSATION_LENGTH || index + 1 >= pool.length) {
      setDone(true);
      push('hrishi', `That's the stack. ${nextCorrect} of ${nextAnswered}. Same table tomorrow?`);
    } else {
      setIndex((i) => i + 1);
      later(() => push('hrishi', OPENERS[(index + 1) % OPENERS.length]), 260);
    }
  };

  const pick = (item: ChatItem, choiceId: string) => {
    if (busy || awaitingNext || done) return;
    const choice = item.choices.find((c) => c.id === choiceId);
    if (!choice) return;
    const isCorrect = choiceId === item.correctId;
    const answerText = item.choices.find((c) => c.id === item.correctId)?.text ?? '';
    setBusy(true);
    setChosen(choiceId);
    push('you', choice.text);

    const nextAnswered = answered + 1;
    const nextCorrect = correct + (isCorrect ? 1 : 0);
    const nextStreak = isCorrect ? streak + 1 : 0;
    setAnswered(nextAnswered);
    setCorrect(nextCorrect);
    setStreak(nextStreak);
    setBestStreak((prev) => Math.max(prev, nextStreak));

    setTyping(true);
    const reply = isCorrect
      ? chooseReply(
          CORRECT_REPLIES,
          nextAnswered * 7 + nextStreak * 3 + item.prompt.length + choiceId.charCodeAt(0)
        )
      : chooseReply(
          WRONG_REPLIES,
          nextAnswered * 5 + item.prompt.length * 3 + choiceId.charCodeAt(0)
        );

    later(() => {
      setTyping(false);
      push('hrishi', reply, isCorrect ? 'good' : 'bad');
      if (!isCorrect) {
        later(() => {
          push('hrishi', `The key is “${answerText}.” ${item.explanation}`);
        }, 420);
      }
    }, 620);

    if (isCorrect) {
      // A clean answer moves on by itself; a miss waits for the reader, because
      // the correction underneath is the part worth keeping.
      later(() => advanceTurn(nextAnswered, nextCorrect), 1100);
    } else {
      later(() => {
        setBusy(false);
        setAwaitingNext(true);
      }, 1360);
    }
  };

  useEffect(() => {
    if (!done || awardedRef.current || answered === 0) return;
    awardedRef.current = true;
    const timeSpent = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000));
    void app.actions.completeSession({
      activityType: 'mini_game',
      sessionId: sessionRef.current,
      questions: answered,
      correct,
      timeSpentSeconds: timeSpent,
    });
  }, [answered, app.actions, correct, done]);

  if (!seed) {
    return (
      <Card>
        <div className="row-between">
          <div className="row">
            <h2 style={{ margin: 0 }}>Table Talk</h2>
            <Badge tone="info">Reading &amp; Writing</Badge>
          </div>
          <Badge tone="neutral">8 exchanges</Badge>
        </div>
        <p className="muted">
          Hrishi is at the back table with a stack of reading items and a cooling coffee. Answer
          his cards by replying in the chat; he reacts to every choice, and the passage stays on
          the table until you decide.
        </p>
        <div className="talk-preview" aria-hidden="true">
          <div className="talk-preview-bubble">You made it. Sit — I saved the lamp.</div>
          <div className="talk-preview-bubble is-you">What are we working on?</div>
        </div>
        <Button onClick={begin}>
          <Icon name="chat" size={14} /> Sit down
        </Button>
      </Card>
    );
  }

  const progress = Math.min(answered, CONVERSATION_LENGTH);

  return (
    <Card className="talk-card">
      <GameShell title="Table Talk" hint={`${progress} / ${CONVERSATION_LENGTH} · ${correct} correct`}>
      <div className="talk-scene" aria-hidden="true">
        <div className="talk-window" />
        <div className="talk-rain" />
        <div className="talk-lamp" />
        <div className="talk-glow" />
      </div>

      <div className="talk-head">
        <div className={`talk-avatar${typing ? ' is-talking' : ''}`} aria-hidden="true">
          <span className="talk-avatar-hair" />
          <span className="talk-avatar-face">
            <span className="talk-eye" />
            <span className="talk-eye" />
            <span className="talk-mouth" />
          </span>
          <span className="talk-avatar-scarf" />
        </div>
        <div className="talk-who">
          <strong>Hrishi</strong>
          <span className="muted">
            {typing ? 'typing…' : done ? 'closing his notebook' : 'late table, third coffee'}
          </span>
        </div>
        <div className="talk-hud">
          <Badge tone="info">
            {progress} / {CONVERSATION_LENGTH}
          </Badge>
          <Badge tone={streak > 1 ? 'good' : 'neutral'}>Streak {streak}</Badge>
          <Badge tone="neutral">{correct} correct</Badge>
        </div>
      </div>

      <div className="talk-log" ref={scrollRef} aria-live="polite">
        {log.map((bubble) => (
          <div
            key={bubble.id}
            className={`talk-bubble${bubble.from === 'you' ? ' is-you' : ''}${
              bubble.tone ? ` is-${bubble.tone}` : ''
            }`}
          >
            <MathText text={bubble.text} />
          </div>
        ))}
        {typing ? (
          <div className="talk-bubble talk-typing" aria-label="Hrishi is typing">
            <span />
            <span />
            <span />
          </div>
        ) : null}
      </div>

      {done ? (
        <div className="talk-summary">
          <div className="card-grid">
            <Stat label="Exchanges" value={answered} />
            <Stat label="Correct" value={correct} />
            <Stat
              label="Accuracy"
              value={answered ? `${Math.round((correct / answered) * 100)}%` : '—'}
            />
            <Stat label="Best streak" value={bestStreak} />
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <Button onClick={begin}>Talk again</Button>
            <Button
              variant="outline"
              onClick={() => {
                setSeed(null);
                setLog([]);
                setDone(false);
              }}
            >
              Leave the table
            </Button>
          </div>
        </div>
      ) : current ? (
        <div className="talk-turn">
          {current.stimulus ? (
            <div className="talk-note">
              <span className="talk-note-tag">{current.skill}</span>
              <div className="stimulus">
                <StimulusView stimulus={current.stimulus} />
              </div>
            </div>
          ) : null}
          <div className="talk-question">
            <MathText text={current.prompt} />
          </div>
          <div className="talk-options">
            {current.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className={`talk-option${
                  chosen === choice.id
                    ? choice.id === current.correctId
                      ? ' is-correct'
                      : ' is-wrong'
                    : ''
                }`}
                disabled={busy || awaitingNext}
                onClick={() => pick(current, choice.id)}
              >
                <MathText text={choice.text} />
              </button>
            ))}
          </div>
          {awaitingNext ? (
            <div className="talk-next">
              <Button size="sm" onClick={() => advanceTurn(answered, correct)}>
                Next card →
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="muted">No reading items are available right now.</p>
      )}
      </GameShell>
    </Card>
  );
}
