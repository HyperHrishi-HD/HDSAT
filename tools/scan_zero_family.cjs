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

let multiple = 0;
for (const q of rows) {
  const factors = [...(q.stimulus || '').matchAll(/\(x\s*([-+])\s*(\d+)\)/g)].map(
    (m) => (m[1] === '-' ? Number(m[2]) : -Number(m[2]))
  );
  const zeros = factors;
  const hits = (q.choices || []).filter((c) => {
    const v = num(c.text);
    return v !== null && zeros.includes(v);
  });
  const keyChoice = (q.choices || []).find((c) => c.id === q.correct_answer);
  const keyValue = keyChoice ? num(keyChoice.text) : null;
  if (hits.length !== 1 || keyValue === null || !zeros.includes(keyValue)) {
    multiple += 1;
    console.log(q.id, 'zeros=', zeros.join(','), 'choices=', (q.choices || []).map((c) => c.text).join(' | '), 'key=', q.correct_answer);
  }
}
console.log('zero-family items', rows.length, 'suspect', multiple);
