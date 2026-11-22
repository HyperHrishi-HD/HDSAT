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
| SMTP login | Brevo's generated relay login (`<relay-id>@smtp-brevo.com`), not the account email |
| Sender | `HDSAT <the operator's mailbox>` |
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
   SMTP_LOGIN=<relay-id>@smtp-brevo.com
   SMTP_PASSWORD=<Brevo SMTP key>
   SMTP_SENDER=<operator mailbox>
   SMTP_SENDER_NAME=HDSAT
   ```

   The SMTP key is generated in Brevo under **SMTP & API → SMTP**. It is shown
   once; keep it out of chat and out of version control.

2. Put `SUPABASE_ACCESS_TOKEN` in `.pa/supabase_credentials`.

3. Run `python supabase/email-templates/apply_auth_config.py`. It sets SMTP, the
   30/hour limit, the branded template, the 6-digit OTP length, Site URL and
   redirects, then verifies every field. Neither script prints a secret.

## Google sign-in

Google is an OAuth provider in Supabase Auth, not SMTP. It arrives with a
provider-verified email, so the Account page treats it as confirmed without a
6-digit code.

### Exact values for this project

| Setting | Value |
| --- | --- |
| Supabase project ref | `qijfmwjcaminecxmbtcf` |
| Google authorized redirect URI | `https://qijfmwjcaminecxmbtcf.supabase.co/auth/v1/callback` |
| Google authorized JavaScript origin | `https://hdsat.pythonanywhere.com` |
| App home page | `https://hdsat.pythonanywhere.com/` |
| Privacy policy | `https://hdsat.pythonanywhere.com/#/privacy` |
| Terms of service | `https://hdsat.pythonanywhere.com/#/terms` |
| Scopes | `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` |

### Setup

1. In Google Cloud Console, create an OAuth 2.0 **Web application** client.
2. Add the exact **Authorized redirect URI** above.
3. In Supabase, open Authentication → Providers → Google, enable it, and paste
the Google client ID and client secret there (never in this repository).
4. Keep `https://hdsat.pythonanywhere.com/**` (and the localhost entries above)
   in Authentication → URL Configuration → Redirect URLs. The app sends Google
   back to the site root; `main.tsx` then lands on `Account`.

The in-app button is **Continue with Google** on the sign-in card. A Google
account is usable as soon as the provider returns; no separate confirmation
email is sent for that sign-in.

### Removing Google's warning without paying for verification

Google OAuth verification has no fee. HDSAT asks only for the three basic
identity scopes, so there is no sensitive-scope security assessment. To remove
the warning for every user, the app must be published (External → In production)
and its branding verified. Google's brand check is free and usually automated.

Brand verification requires owning the top private domain used by the home
page, privacy policy, terms and redirect URLs. `hdsat.pythonanywhere.com` is a
subdomain of PythonAnywhere, not a domain HDSAT owns, so it cannot be verified
in Search Console. The reliable free-of-verification-fee route is therefore:

1. Point a domain you own (for example `hdsat.example`) at the PythonAnywhere
   app and enable HTTPS. PythonAnywhere custom domains require a paid account;
   Google's verification itself remains free.
2. Change Supabase Site URL and Redirect URLs to that domain, and change the
   app's `VITE_SITE_URL` to it.
3. Put the home page, privacy policy and terms on that domain, then verify the
domain in Google Search Console with the same Google account that owns the
Cloud project.
4. In Google Auth Platform → Branding, use app name **HDSAT**, the support
   email, that home page, privacy policy and terms. Add `example.com` and
   `supabase.co` as authorized domains, then click **Verify Branding**.
5. Google may email about the `supabase.co` redirect domain because it belongs
   to Supabase. Reply that it is a third-party OAuth callback you do not own;
   this is the standard Supabase flow. Publish the app to production after the
   branding check passes.

Until that is done, the app can still be tested by keeping the Google app in
**Testing** and adding each Google account under **Audience → Test users**. That
path works immediately for up to 100 accounts, but those users see Google's
testing warning and must choose **Continue**.

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
