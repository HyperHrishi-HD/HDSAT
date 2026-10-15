export function normalizeText(value) {
    return value.replace(/\s+/g, ' ').trim();
}
/** Parse an SAT student-produced response into a number when possible. */
export function parseNumeric(value) {
    if (value === null || value === undefined)
        return null;
    const cleaned = String(value).replace(/\s/g, '').replace(/,/g, '');
    if (cleaned === '')
        return null;
    if (cleaned.includes('/')) {
        const [top, bottom] = cleaned.split('/');
        const t = Number(top);
        const b = Number(bottom);
        if (Number.isFinite(t) && Number.isFinite(b) && b !== 0)
            return t / b;
        return null;
    }
    if (cleaned.includes('.')) {
        const trimmed = cleaned.replace(/\.$/, '');
        const n = Number(trimmed);
        return Number.isFinite(n) ? n : null;
    }
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}
/**
 * Grade a single response. Multiple choice is graded by choice id; SPR answers
 * accept either an exact normalized string or a numeric match within 1e-6 so
 * that "9", "9.0" and "18/2" all grade correctly.
 */
export function checkAnswer(question, response) {
    if (response === null || response === undefined)
        return false;
    const given = normalizeText(String(response));
    if (given === '')
        return false;
    if (question.format === 'multiple_choice') {
        return given.toUpperCase() === normalizeText(question.correct_answer).toUpperCase();
    }
    const accepted = [question.correct_answer, ...(question.acceptable_answers || [])];
    const givenNumber = parseNumeric(given);
    return accepted.some((candidate) => {
        if (normalizeText(candidate).toUpperCase() === given.toUpperCase())
            return true;
        const target = parseNumeric(candidate);
        return givenNumber !== null && target !== null && Math.abs(givenNumber - target) < 1e-6;
    });
}
export function isAnswered(response) {
    return response !== null && response !== undefined && normalizeText(String(response)) !== '';
}
