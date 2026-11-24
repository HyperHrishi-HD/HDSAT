# HDSAT Public-Launch Upgrade — 4-Phase Loose-Follow Prompt

Saved: 2026-11-07 from the attached 49,994-byte `HDSAT_Upgrade_4Phase_LooseFollow.md`.
This is the working copy for execution. The owner addendum below is reproduced verbatim; every phase item is preserved with its operative requirements. The full original attachment remains in the chat for exact wording.

> **Follow this prompt LOOSELY. It is a strategy and checklist, not a literal revamp order.**
>
> 1. **NO UI REVAMP.** Do NOT redesign, re-layout, restructure, or rebrand the site. Do NOT change page structure, navigation, component arrangement, or the current visual identity. The site is still in active development by the owner — its current UI stays.
> 2. **Phase 1 is RULES-ONLY.** Use Phase 1 only to (a) apply its UI *rules* (anti-slop bans, consistency, contrast, spacing/type discipline, motion discipline) to work you are already touching, and (b) fix small, named UI *bugs/defects* already listed there (e.g. flagged questions on results, Browse All, display counts like "10,000+" instead of raw totals, empty states, loading skeletons where trivial). If any Phase 1 item would require a revamp, a new layout, or moving things around — **SKIP it, note it as DEFERRED-BY-OWNER in your report, and move on.** Do not argue for it.
> 3. **The real priority is the BACKEND strategy: Phases 2, 3, and 4** — performance & reliability, security, and legal & trust. Perfect those. That is the point of running this prompt now.
> 4. Everything else below still stands in full: the ground rules (live site is the only source of truth, never guess the admin passcode, Brevo email budget, never log secrets, no deploy unless the owner explicitly asks), THE PROTOCOL (check → if it exists, verify automatically, never rebuild → implement → verify → fixed-format report), and Part 5 notify-and-stop for owner inputs.

## Part 0 — Ground rules

1. **The live site is the only source of truth.** The GitHub repo is an intentionally stripped reference export; deploying repo `main` over the live site would regress it.
2. **Never guess, brute-force, or probe the admin passcode.** Failed attempts can lock the owner out. If a task needs admin access, stop and notify the owner.
3. **Never spend the email budget carelessly.** Brevo allows 300/day; the app stops at 280; one confirmation per address per day. No test sends to real addresses.
4. **Never print, log, or commit secrets** — keys, tokens, passcodes, connection strings.
5. **No deploy unless the owner explicitly asks in the session.**
6. **Do not regress what works.** Baseline suites must stay green: Vitest and pytest. Re-run the relevant suite after every item; both at every phase gate. If a baseline fails, that item is not done.
7. **Standing exclusions:** growing the bank's count as a goal, Google OAuth work until its dedicated day, splitting the catalogue database, re-exporting the public repo.
8. **Known-not-a-bug:** `mark_email_verified()` soft gate; Supabase management-token 401s in owner tooling; light accounts usable before confirmation; practice sometimes returning fewer items; arcade payouts lower-biased 5–50; guest progress not auto-merging (manual "Sync device" is the design).
9. **One item at a time.** Check → implement-or-skip → verify → report. No batch half-finishes.

## Part 1 — Protocol for every item

1. **CHECK** whether the item is already implemented on the live site/in the live codebase, using the item's check line. Cite the file, route, query result, or observed behavior.
2. **ALREADY DONE → VERIFY, DON'T REBUILD.** Run the item's verification. Mark `ALREADY IMPLEMENTED — VERIFIED` with evidence.
3. **MISSING/BROKEN → IMPLEMENT** the smallest change inside the existing architecture/design.
4. **VERIFY** automatically (test, query, curl, rendered check), not by eyeballing code.
5. **REPORT** exactly:
   ```
   [PHASE n · ITEM x.y] <item name>
   Status: ALREADY IMPLEMENTED — VERIFIED | IMPLEMENTED — VERIFIED | BLOCKED — OWNER INPUT NEEDED
   Found: <what CHECK found, with evidence>
   Did: <what changed, or "nothing — already correct">
   Verified by: <exact verification and result>
   ```
6. **NOTIFY AND STOP** at any Part 5 condition. Finish unaffected items, then present all open notifications together.

## Part 2 — Verified starting map (2026-11-04)

- Vite + React 18 + TypeScript SPA (HashRouter), thin Flask backend (`/api/health`, `/api/config`, `/api/legal`, `/api/catalog/summary`), Supabase Postgres/Auth/RLS/RPC, Brevo SMTP, PythonAnywhere, service worker `hdsat-v8`.
- Live: bank version `2026.11.06-open-core-37`; 10,024 questions (Math 6,388 / R&W 3,636); 1,804 flashcards; 105 resources; 11 lazy route chunks plus a ~13 MB question-bank chunk; `/api/health` reports `dist_ready: true`.
- Exam: 98 questions / 134 minutes + 10-minute break; modules 27 R&W + 22 Math per stage; 90 scored + 8 unscored; adaptive; Desmos + reference sheet; highlighting, cross-out, Mark for Review, navigator, Save & Exit.
- Already true (verify, don't rebuild): dark mode with prepaint anti-flash; 8 store themes; PWA manifest; design tokens (`--bg #f6f8fb`, `--ink #14181f`, `--accent #1f5fd0`, `--muted #6b7686`, `--line #e2e7f0`, `--radius 10px`, `--radius-lg 16px`; dark bg `#0f1216`); guest landing hero; legal version 1.3 across four pages; `#/bank?saved=1`; question report status/replies; honest coin copy.
- Confirmed broken at audit: flagged questions absent from practice results; Interceptor accuracy uncapped; no true all-cards flashcard list.
- Known gaps: empty `support_email`; bare `<title>`; no self-hosted brand typeface; favicon predates themes; deploy-window asset shell/caching risk.

## Phase 1 — UI & aesthetic (rules only; no revamp)

1.1 **Skeleton loading screens** — shaped skeletons for Home, Bank, Practice, Full Test, Score Report, Arcade, Leaderboard, Account; no spinners; no layout shift; reduced-motion respected.
1.2 **Anti-slop pass** — zero purple-to-blue/rainbow gradients, zero gradient-clipped text; flat token surfaces; one accent; emoji not used as UI icons; consistent radius/elevation.
1.3 **Self-hosted brand typography** — one self-hosted woff2 family, no Google Fonts CDN; keep Georgia/KaTeX; no CLS regression.
1.4 **Title, meta, share surface** — `<title>` “HDSAT — Free Digital SAT & PSAT Practice”; OG/Twitter tags, share image, theme-color light/dark, favicon set.
1.5 **Home answers “What should I do today?”** — daily quest/streak, one recommended weakest-skill session, per-skill mastery + overall; guests keep hero.
1.6 **Empty states that teach** — what belongs, action that fills it, working button; no bare “No data.”
1.7 **Cross-linking one bank, many modes** — skill domain ↔ drill ↔ flashcards ↔ arcade; no new content; filtered landings.
1.8 **Dark mode as a second token set** — contrast audit, dark surfaces, all 8 themes, prepaint in both modes.
1.9 **Mobile-first reality check** — 360px, one-thumb nav, ≥44px targets, no horizontal scroll, full test operable.
1.10 **Performance budget + 13 MB bank chunk** — p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1; lazy/paginated bank data; initial payload under budget.
1.11 **Two known UX defects** — flagged questions on practice results (right or wrong); true “Browse All” flashcard list/grid with jump-to-card.
1.12 **Motion/feedback discipline** — ≤200ms ease-out; optimistic saves/flags with rollback; quiet success states.

Phase 1 gate: all items reported; both suites green; before/after visual summary with grep counts and Lighthouse numbers. **Skip and mark DEFERRED-BY-OWNER anything requiring a revamp.**

## Phase 2 — Performance & reliability at real traffic

2.1 **Database indexes** — `EXPLAIN ANALYZE` hot paths (practice selection by domain/difficulty, leaderboard top 5, catalogue summary, saved/flagged); add composite indexes; re-run.
2.2 **Cache read-mostly endpoints** — short max-age + ETag/revalidation for summary/config/legal; key legal to `legal_version`; never cache user-specific/auth responses.
2.3 **Image/asset weight audit** — inventory, compress/resize, modern formats where possible, keep maskable icons; no visual regressions.
2.4 **Load test** — k6/Artillery ramp to a few hundred concurrent guest sessions on read paths; never email/write/budget paths; report p95/error rate; local/staging if production is not responsible.
2.5 **Rate limiting** — per-IP/per-route on all Flask API routes; generous reads, strict state changes; clean 429 + `Retry-After`.
2.6 **Service-worker/deploy-window safety** — cache only matching content types; never cache HTML under JS/CSS; version caches per deploy and purge old; post-deploy asset content-type check.
2.7 **Backups actually restored once** — off-PythonAnywhere `pg_dump`, separate bank export, documented restore; test restore row counts. Destination is owner input.
2.8 **Structured logging** — auth, email queue/send, coin RPCs, sync merges, 5xx; no secrets; ≥14 days; friendly UI errors, no raw Postgres errors.

Phase 2 gate: items reported; load test attached; restore proven; both suites green.

## Phase 3 — Security (risk order)

3.1 **(P0) RLS every table/operation** — RLS on, no `USING (true)` on private data, UPDATE policies include `WITH CHECK`, per-user policies scoped to `auth.uid()`; verify as anon and second user.
3.2 **(P0) SECURITY DEFINER RPC lockdown** — revoke PUBLIC/anon, grant authenticated only where needed, identity from `auth.uid()` inside the function, pinned `search_path`, invoker where possible; crafted coin calls cannot mint.
3.3 **(P0) Key hygiene** — scan bundle and git history for service_role/Brevo/Flask/connection strings; anon key may ship; service_role never; rotate only with owner approval; add secret scan to CI.
3.4 **Admin console seatbelts** — without attempting the passcode: no admin data in client bundle; server-side rate limit/lockout atop proof-of-work; append-only admin audit log. If verification needs the passcode, mark BLOCKED.
3.5 **Email-path abuse protection** — generic responses (no account enumeration), per-address cooldown + per-IP velocity before queueing, Supabase Auth protections; evaluate Turnstile (owner keys if adopted); verify enumeration/flood/daily cap/normal signup.
3.6 **Flask hardening** — debug off, env `SECRET_KEY`, secure cookies if used, `MAX_CONTENT_LENGTH`, CORS only own origin, no stack traces in production.
3.7 **Security headers incl. PythonAnywhere trap** — CSP/HSTS/nosniff/frame/referrer on dynamic AND nginx-served static files via static-headers API; force HTTPS; CSP report-only → enforce with Desmos/Supabase allowlists; verify no console violations.
3.8 **XSS surface** — inventory `dangerouslySetInnerHTML`; sanitize stored content (DOMPurify or text/markdown render); script-payload test in practice/bank/results/admin.
3.9 **Dependency hygiene** — `npm audit`, `pip-audit`; patch, document deferrals, add Dependabot; remove dead packages; suites/build still green.
3.10 **Authorization data placement** — authorization facts in `raw_app_meta_data`/server table, never editable `raw_user_meta_data`; derive identity from JWT only; test user self-edit gains nothing.

Phase 3 gate: all items reported; two-user isolation transcript, RPC proof, secret scan, header matrix; both suites green.

## Phase 4 — Legal & trust

4.1 **Age screen/COPPA** — neutral age screen before account creation; under-13 hard block with nothing persisted; verify 12/13/17/18 bands match Privacy claims.
4.2 **Privacy data table** — item → purpose → processor → retention; cover email/auth, progress/scores, reports, local/guest/outbox, logs; processors Supabase/Brevo/PythonAnywhere; deletion path; no sale; independent-study line.
4.3 **Empty support_email** — owner supplies address; prepare config/legal/footer/DMCA slots; verify renders and test message received.
4.4 **College Board trademark** — no acorn, no CB marks in domains/taglines/meta, brand first, ® on first prominent use, own-brand disclaimer on every page with marks; PSAT/NMSQT + NMSC joint-credit wording; footer on all routes.
4.5 **Email compliance** — reconcile stated vs enforced validity (known 12h vs 24h bug); working unsubscribe + owner-supplied postal address where required; render every template and complete confirmation.
4.6 **DMCA agent** — owner files ($6, legal name); draft Copyright DMCA section, Terms repeat-infringer clause, placeholder contact, takedown runbook; verify after filing.
4.7 **Question-bank provenance** — per-item source/author/date/license coverage; CC-BY/CC BY-SA attribution, links, modifications, share-alike on Credits; verify 100%.
4.8 **Terms completeness** — eligibility/age, accounts/one-account, acceptable use/no scraping, user-content licence, site IP, score-estimate disclaimer (no guaranteed gains), as-is/liability, termination, governing law, changes, DMCA; bump `legal_version`; trace every section.
4.9 **Things not to claim** — no FERPA certification; no session replay/keystroke tools without consent + masking (default removal for minors); no ad/analytics beacons beyond declared; inventory matches Privacy 1:1.
4.10 **Accessibility statement** — WCAG 2.2 AA target, honest known limitations, feedback route, footer link on all routes.

Phase 4 gate: items reported; privacy reconciliation, trademark sweep, template renders; `legal_version` bumped if changed; both suites green.

## Part 5 — Stop and notify the owner

Use the fixed block:
```
⚠️ OWNER INPUT NEEDED — [item]
What's blocked: …
What I need from you: … (exact decision/value/action)
What happens when you answer: …
Prepared and waiting: …
```

Queued owner inputs: support email, postal address for email footers, DMCA registration, backup destination, secret rotation, Turnstile/CAPTCHA keys, anything requiring the admin passcode. Also notify when an item's premise is already better than described, a phase gate fails, or a baseline breaks and was reverted.

## Part 6 — Definition of done

Every Phase 1–4 item has a Part 1 report; every phase gate passed; Vitest and pytest green at the end; all Part 5 notifications resolved or in one clear owner list; final two-minute summary: what changed, what was already fine, what still needs the owner, with proofs (grep counts, Lighthouse, load p95s, isolation results, scans).

**Work in order. Check before you build. Verify before you claim. Notify before you guess.**
