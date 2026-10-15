/**
 * Digital SAT Suite structure, taken from the public College Board description:
 * Reading and Writing 27 items / 32 minutes per module, Math 22 items /
 * 35 minutes per module, two modules per section with the second module routed
 * by first-module performance. HDSAT scales module length and time down when the
 * available licensed bank cannot fill a module, and says so in the interface.
 */
export const SECTION_SPECS = {
    'Reading and Writing': { fullItems: 27, fullMinutes: 32 },
    Math: { fullItems: 22, fullMinutes: 35 },
};
export const SECTION_ORDER = ['Reading and Writing', 'Math'];
/** Fraction of module-1 items a student must answer correctly to be routed up. */
export const ROUTING_THRESHOLD = 0.6;
const DIFFICULTY_WEIGHT = { Easy: 0, Medium: 1, Hard: 2 };
export function hashSeed(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
export function seededShuffle(items, seed) {
    const out = items.slice();
    let state = hashSeed(seed) || 1;
    for (let i = out.length - 1; i > 0; i -= 1) {
        state = (state * 1664525 + 1013904223) >>> 0;
        const j = state % (i + 1);
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
    }
    return out;
}
function pickByPreference(pool, count, preference) {
    const buckets = { Easy: [], Medium: [], Hard: [] };
    pool.forEach((q) => buckets[q.difficulty].push(q));
    const chosen = [];
    for (const difficulty of preference) {
        while (chosen.length < count && buckets[difficulty].length > 0) {
            chosen.push(buckets[difficulty].shift());
        }
    }
    if (chosen.length < count) {
        for (const difficulty of ['Easy', 'Medium', 'Hard']) {
            while (chosen.length < count && buckets[difficulty].length > 0) {
                chosen.push(buckets[difficulty].shift());
            }
        }
    }
    return chosen;
}
function buildModulePlan(section, tier, questions, targetItems, minutes) {
    return {
        id: `${section === 'Math' ? 'math' : 'rw'}-${tier}`,
        section,
        tier,
        questions,
        targetItems,
        minutes,
    };
}
export function buildTestPlan(all, options) {
    const seed = options.seed ?? 'hdsat-test';
    const warnings = [];
    const sections = [];
    for (const section of SECTION_ORDER) {
        const spec = SECTION_SPECS[section];
        const target = Math.max(4, Math.min(spec.fullItems, options.itemCap ?? spec.fullItems));
        const pool = seededShuffle(all.filter((q) => q.section === section &&
            q.assessments.includes(options.assessment) &&
            !(options.excludeReleasedPracticeSet && q.is_released_practice_set)), `${seed}:${section}`);
        const module1 = pickByPreference(pool, target, ['Medium', 'Easy', 'Hard']);
        const used = new Set(module1.map((q) => q.id));
        const remaining = pool.filter((q) => !used.has(q.id));
        const upper = pickByPreference(remaining, target, ['Hard', 'Medium', 'Easy']);
        const usedUpper = new Set(upper.map((q) => q.id));
        const lower = pickByPreference(remaining.filter((q) => !usedUpper.has(q.id)), target, ['Easy', 'Medium', 'Hard']);
        const coverageRatio = module1.length / target;
        const minutesFor = (items) => items >= target ? spec.fullMinutes : Math.max(4, Math.round(spec.fullMinutes * (items / target)));
        if (module1.length < target) {
            warnings.push(`${section}: only ${pool.length} licensed item(s) available for this assessment, so each module uses ${module1.length} of ${target} items (${Math.round(coverageRatio * 100)}% coverage) with proportionally shortened timers.`);
        }
        if (upper.length < target || lower.length < target) {
            warnings.push(`${section}: the adaptive second module cannot be filled at full length from the current bank (upper ${upper.length}, lower ${lower.length} of ${target}).`);
        }
        sections.push({
            section,
            availableItems: pool.length,
            targetItems: target,
            module1: buildModulePlan(section, 'module1', module1, target, minutesFor(module1.length)),
            upper: buildModulePlan(section, 'upper', upper, target, minutesFor(upper.length)),
            lower: buildModulePlan(section, 'lower', lower, target, minutesFor(lower.length)),
        });
    }
    return { assessment: String(options.assessment), createdAt: new Date().toISOString(), sections, warnings, seed };
}
export function routeModule(module1Correct, module1Total) {
    if (module1Total <= 0)
        return 'lower';
    return module1Correct / module1Total >= ROUTING_THRESHOLD ? 'upper' : 'lower';
}
/**
 * HDSAT scaled-score estimate. Both sections are reported on the real SAT
 * 200-800 scale; the value is derived from accuracy plus the difficulty tier the
 * student was routed to. It is an HDSAT practice estimate, not an official
 * College Board score.
 */
export function estimateScaledScore(tier, correct, total) {
    if (total <= 0)
        return null;
    const accuracy = Math.max(0, Math.min(1, correct / total));
    let score = 200 + 600 * accuracy;
    const tierBoost = tier === 'upper' ? (accuracy >= 0.5 ? 40 : -10) : accuracy >= 0.5 ? -30 : -60;
    score += tierBoost;
    const clamped = Math.max(200, Math.min(800, score));
    return Math.round(clamped / 10) * 10;
}
export function summarizeTest(modules) {
    const estimateFor = (section) => {
        const sectionModules = modules.filter((m) => m.section === section);
        if (sectionModules.length === 0)
            return null;
        const correct = sectionModules.reduce((acc, m) => acc + m.correct, 0);
        const total = sectionModules.reduce((acc, m) => acc + m.total, 0);
        const routingModule = sectionModules.find((m) => m.tier !== 'module1');
        return estimateScaledScore(routingModule?.tier === 'upper' ? 'upper' : 'lower', correct, total);
    };
    const rwEstimate = estimateFor('Reading and Writing');
    const mathEstimate = estimateFor('Math');
    const totalEstimate = rwEstimate !== null && mathEstimate !== null ? rwEstimate + mathEstimate : null;
    return { rwEstimate, mathEstimate, totalEstimate };
}
export function formatClock(totalSeconds) {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = safe % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
export function filterQuestions(all, filters, progress = {}, savedIds = []) {
    const savedSet = new Set(savedIds);
    return all.filter((q) => {
        if (filters.assessment && !q.assessments.includes(String(filters.assessment)))
            return false;
        if (filters.section && filters.section !== 'all' && q.section !== filters.section)
            return false;
        if (filters.domain && filters.domain !== 'all' && q.domain !== filters.domain)
            return false;
        if (filters.difficulty && filters.difficulty !== 'all' && q.difficulty !== filters.difficulty)
            return false;
        if (filters.sourceId && filters.sourceId !== 'all' && q.source_id !== filters.sourceId)
            return false;
        if (filters.onlySaved && !savedSet.has(q.id))
            return false;
        if (filters.onlyIncorrect && progress[q.id]?.lastIsCorrect !== false)
            return false;
        if (filters.excludePreviouslyCorrect && (progress[q.id]?.correctCount ?? 0) > 0)
            return false;
        if (filters.excludeReleasedPracticeSet && q.is_released_practice_set)
            return false;
        return true;
    });
}
export function buildPracticeSession(all, filters, options) {
    let pool = filterQuestions(all, filters, options.progress ?? {}, options.savedIds ?? []);
    if (options.format && options.format !== 'both') {
        pool = pool.filter((q) => q.format === options.format);
    }
    const ordered = seededShuffle(pool, options.seed ?? `practice:${Date.now()}`);
    // Balance sections when both are requested so a mixed session is not all one section.
    if (!filters.section || filters.section === 'all') {
        const rw = ordered.filter((q) => q.section === 'Reading and Writing');
        const math = ordered.filter((q) => q.section === 'Math');
        const half = Math.ceil(options.count / 2);
        const mixed = [];
        const rwTake = rw.slice(0, Math.min(half, rw.length));
        const mathTake = math.slice(0, Math.min(options.count - rwTake.length, math.length));
        mixed.push(...rwTake, ...mathTake);
        if (mixed.length < options.count) {
            const used = new Set(mixed.map((q) => q.id));
            for (const q of ordered) {
                if (mixed.length >= options.count)
                    break;
                if (!used.has(q.id)) {
                    mixed.push(q);
                    used.add(q.id);
                }
            }
        }
        return seededShuffle(mixed, `${options.seed ?? 'practice'}:order`).slice(0, options.count);
    }
    return ordered.slice(0, options.count);
}
export function averageDifficulty(questions) {
    if (questions.length === 0)
        return 0;
    const sum = questions.reduce((acc, q) => acc + DIFFICULTY_WEIGHT[q.difficulty], 0);
    return sum / questions.length;
}
export function countByDifficulty(questions) {
    const counts = { Easy: 0, Medium: 0, Hard: 0 };
    questions.forEach((q) => {
        counts[q.difficulty] += 1;
    });
    return counts;
}
