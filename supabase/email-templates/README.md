# HDSAT confirmation email and auth URLs

Supabase's project email templates and redirect allowlist live in the Supabase
dashboard, not in this repository, so they have to be applied once by hand.
Everything the app can control (the `emailRedirectTo` value, code verification,
and the post-confirmation import) is already implemented.

## 1. Stop links from pointing at localhost

Supabase Dashboard → **Authentication → URL Configuration**

- **Site URL:** `https://hdsat.pythonanywhere.com`
- **Redirect URLs** (add each on its own line):
  - `https://hdsat.pythonanywhere.com/**`
  - `http://localhost:5173/**` (Vite dev only)
  - `http://localhost:3000/**` (if you use port 3000)

The app now sends `emailRedirectTo=https://hdsat.pythonanywhere.com/`
(`VITE_SITE_URL`), so new confirmation emails return to production. If the URL
is missing from the allowlist, Supabase silently falls back to **Site URL**,
which is exactly how the old localhost links were produced.

## 2. Send a branded HDSAT email

Supabase Dashboard → **Authentication → Email Templates → Confirm signup**

- **Subject:** `Confirm your HDSAT account`
- **Body:** paste the full contents of [`confirmation.html`](confirmation.html).

The template uses `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .Email }}` and
`{{ .SiteURL }}`. The 6-digit `{{ .Token }}` matters: the Account page verifies
it with `verifyOtp`, which works even when someone opens the email on a phone
and the link cannot reach the app.

Also set **Authentication → SMTP Settings → Sender name** to `HDSAT`, and use a
`From` address on your own domain (for example `no-reply@hdsat.com`) so the
sender line reads `HDSAT <no-reply@…>` instead of the Supabase default.

## 3. Account behaviour before confirmation

- Sign-up creates the account immediately. Supabase does not issue a session
  until the address is confirmed, so the app records the pending address and
  keeps all practice data in this browser.
- That pending state is explained in the first-visit banner, the HDCoins pill
  (`local`), and the banner on the Account page. Cloud sync and the cloud coin
  balance start after confirmation; the local coins shown before then are
  provisional and are replaced, not merged.
- Confirmation (link or code) signs the student in, and the first sign-in imports
  this device's attempts, saved questions, flashcard reviews and test attempts
  exactly once (idempotent event ids).
