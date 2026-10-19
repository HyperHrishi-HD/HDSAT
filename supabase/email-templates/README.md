# HDSAT confirmation email and auth URLs

The app-side auth flow is implemented here; two project settings are managed in
the Supabase dashboard. Site URL, the redirect allowlist and the six-digit OTP
length have already been applied to the live project through the Management API.
The branded template and reliable delivery still need a custom SMTP provider.

**Why custom SMTP is required:** with Supabase's built-in email service, Auth
refuses to deliver to addresses that are not on the project team, caps sending
at `rate_limit_email_sent = 2`, and blocks template editing. Ordinary students
will never receive a confirmation email until SMTP is configured.

## 1. Stop links from pointing at localhost

Already applied live:

- **Site URL:** `https://hdsat.pythonanywhere.com`
- **Redirect URLs:** `https://hdsat.pythonanywhere.com/**`,
  `http://localhost:3010/**`, `http://localhost:5173/**`,
  `http://localhost:3000/**`
- **Email OTP length:** 6 digits (matches the Account page input)

The app sends `emailRedirectTo=https://hdsat.pythonanywhere.com/`
(`VITE_SITE_URL`), so new confirmation emails return to production. If the URL
is missing from the allowlist, Supabase silently falls back to **Site URL**.

## 2. Configure custom SMTP, then apply the branded email

Configure a provider (Brevo's free tier allows 300 messages/day and a verified
single sender) in Supabase Dashboard → **Project Settings → Auth → SMTP
Settings**, or through the Management API. Once SMTP is saved, apply the
template below; Supabase rejects template edits on the default email provider.

## 3. Send a branded HDSAT email

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

## 4. Account behaviour before confirmation

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
