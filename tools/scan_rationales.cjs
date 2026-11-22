const fs = require('fs');
const bank = JSON.parse(fs.readFileSync('src/data/questionBank.json', 'utf8')).questions;

function num(text) {
  const m = String(text).replace(/\$/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

const rows = bank.filter(
  (q) =>
    q.format === 'multiple_choice' &&
    /zero/i.test(q.prompt || '') &&
    /\(x\s*[-+]\s*\d+\)/.test(q.stimulus || '')
);

let bad = 0;
for (const q of rows) {
  const factors = [...(q.stimulus || '').matchAll(/\(x\s*([-+])\s*(\d+)\)/g)].map(
    (m) => (m[1] === '-' ? Number(m[2]) : -Number(m[2]))
  );
  for (const choice of q.choices || []) {
    if (choice.id === q.correct_answer) continue;
    const text = (q.distractor_rationales || {})[choice.id];
    if (!text) continue;
    const mentioned = [...text.matchAll(/(?:x\s*=\s*|value\s*)(-?\d+)/g)].map((m) => Number(m[1]));
    const own = num(choice.text);
    for (const value of mentioned) {
      if (value !== own && factors.includes(value)) {
        bad += 1;
        console.log(q.id, 'choice', choice.id, '=', choice.text, 'rationale names', value, '::', text.slice(0, 120));
        break;
      }
    }
  }
}
console.log('zero-family rationale mismatches', bad);
