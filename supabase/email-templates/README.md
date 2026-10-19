# HDSAT confirmation email and auth URLs

Everything below is **applied to the live project and verified**. Confirmation
emails are sent through Brevo SMTP with the branded template, a 6-digit code, and
a link back to production.

## Live configuration

| Setting | Value |
| --- | --- |
| Site URL | `https://hdsat.pythonanywhere.com` |
| Redirect URLs | `https://hdsat.pythonanywhere.com/**`, `http://localhost:3010/**`, `http://localhost:5173/**`, `http://localhost:3000/**` |
| Email OTP length | 6 digits (matches the Account page input) |
| Email send limit | 30/hour |
| SMTP host | `smtp-relay.brevo.com` (port 587, STARTTLS) |
| SMTP login | `bec76f001@smtp-brevo.com` (Brevo's generated relay login — **not** the account email) |
| Sender | `HDSAT <hdsystem29@gmail.com>` |
| Template | [`confirmation.html`](confirmation.html), subject "Confirm your HDSAT account" |

## Why custom SMTP was required

Supabase's built-in mailer refuses delivery to any address outside the project
team, caps sending at 2 emails/hour, and blocks template editing. Ordinary
students never received a confirmation email until SMTP was configured.

## Re-applying after a change

1. Put the credentials in `.pa/smtp_credentials` (gitignored):

   ```
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587
   SMTP_LOGIN=bec76f001@smtp-brevo.com
   SMTP_PASSWORD=<Brevo SMTP key>
   SMTP_SENDER=hdsystem29@gmail.com
   SMTP_SENDER_NAME=HDSAT
   ```

   The SMTP key is generated in Brevo under **SMTP & API → SMTP**. It is shown
   once; keep it out of chat and out of version control.

2. Put `SUPABASE_ACCESS_TOKEN` in `.pa/supabase_credentials`.

3. Run `python supabase/email-templates/apply_auth_config.py`. It sets SMTP, the
   30/hour limit, the branded template, the 6-digit OTP length, Site URL and
   redirects, then verifies every field. Neither script prints a secret.

## Brevo gotchas

- **Sender must be verified** (Senders, Domains & IPs → Senders). The free plan
  allows a verified single sender; no custom domain is required.
- **Turn off SMTP IP blocking** (Security → Devices → "Blocking unauthorized IP
  addresses" → Deactivate for SMTP keys). Supabase's egress IPs are dynamic, so
  IP allowlisting breaks delivery. With blocking off, the same signup that
  failed with `500 unexpected_failure` / `525 Unauthorized IP address` succeeds
  and sets `confirmation_sent_at`.

## The email itself

The template uses `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .Email }}` and
`{{ .SiteURL }}`. The 6-digit `{{ .Token }}` matters: the Account page verifies
it with `verifyOtp`, which works even when someone opens the email on a phone
and the link cannot reach the app.

## Account behaviour before confirmation

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
