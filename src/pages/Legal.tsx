import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui';
import { AppealForm } from '../components/AppealForm';
import {
  APPEAL_SLA_HOURS,
  COPYRIGHT_PATH,
  CREATOR_GITHUB_URL,
  CREATOR_NAME,
  CREATOR_YOUTUBE_URL,
  CREDITS_PATH,
  LEGAL_LAST_UPDATED,
  LEGAL_STARTED_DATE,
  LEGAL_VERSION,
  MIN_AGE,
  OPERATOR_NAME,
  PRIVACY_PATH,
  SITE_NAME,
  SUPPORT_EMAIL,
  TERMS_PATH,
  governingLawClause,
  venuesClause,
} from '../lib/legal';
import { useApp } from '../lib/store';

function LegalShell({
  title,
  intro,
  children,
  support = true,
  started,
}: {
  title: string;
  intro: string;
  children: ReactNode;
  /** Credits is reachable from Account, so it does not repeat the appeal card. */
  support?: boolean;
  /** Opt in to the founding date next to the last-updated date. */
  started?: boolean;
}) {
  return (
    <div>
      <Card>
        <h1>{title}</h1>
        <p className="muted">
          {started ? `Started ${LEGAL_STARTED_DATE} · ` : `Version ${LEGAL_VERSION} · `}
          Last updated {LEGAL_LAST_UPDATED}
        </p>
        <p>{intro}</p>
        <nav className="row legal-toc" aria-label="Policy pages">
          <Link to={TERMS_PATH}>Terms of Service</Link>
          <Link to={PRIVACY_PATH}>Privacy &amp; Data Rights</Link>
          <Link to={COPYRIGHT_PATH}>Copyright &amp; Content Policy</Link>
          <Link to={CREDITS_PATH}>Credits &amp; Attribution</Link>
        </nav>
      </Card>
      <Card className="legal">{children}</Card>
      {support ? (
      <Card>
        <h2>Support <span className="muted">/ {SITE_NAME}</span></h2>
        {SUPPORT_EMAIL ? (
          <p>
            Questions about these policies, your data or a takedown notice? Email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> or use the appeal form below. We aim to respond
            within {APPEAL_SLA_HOURS} hours.
          </p>
        ) : (
          <p>
            Questions about these policies, your data or a takedown notice? Use the appeal form below and we will reply
            to the contact address you give us. We aim to respond within {APPEAL_SLA_HOURS} hours.
          </p>
        )}
        <AppealForm />
      </Card>
      ) : null}
    </div>
  );
}

export function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      intro={`These Terms are a binding agreement between you and ${OPERATOR_NAME} covering your use of ${SITE_NAME}, a study tool for the digital SAT and PSAT suite. Please read them, along with our Privacy & Data Rights and Copyright & Content Policy.`}
    >
      <h2>1. Who may use {SITE_NAME}</h2>
      <ul>
        <li>You must be at least {MIN_AGE} years old to create an account. Accounts for children under {MIN_AGE} are not offered and will be removed.</li>
        <li>
          If you are under 18, you may only create an account with the involvement of a parent or guardian, who must
          review and agree to these Terms and the Privacy &amp; Data Rights page on your behalf. We record that consent
          with your account.
        </li>
        <li>If you use {SITE_NAME} on behalf of a school or organization, you confirm you are authorized to accept these Terms for it.</li>
      </ul>

      <h2>2. Your account</h2>
      <ul>
        <li>Give accurate registration details and keep your password confidential. You are responsible for activity under your account.</li>
        <li>One account per person. Do not share credentials, resell access, or create accounts by automated means.</li>
        <li>You may delete your account at any time from <em>Account → Safety &amp; data rights</em>. Deletion is permanent and removes your practice history.</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>copy, scrape, bulk-download or republish the question bank, explanations, flashcards or any other content, except as the Copyright &amp; Content Policy allows;</li>
        <li>probe, overload, circumvent or disable security controls, answer-key protection, rate limits or access controls;</li>
        <li>upload or submit unlawful, harassing, hateful or sexually explicit material, or content that infringes someone else&apos;s rights;</li>
        <li>impersonate another person, misrepresent your affiliation, or use {SITE_NAME} to cheat on an official assessment or violate a testing provider&apos;s rules;</li>
        <li>use automated systems (bots, scrapers, scripts) to access the service without our written permission.</li>
      </ul>
      <p>
        We may suspend or terminate access, with or without notice, for conduct that breaks these Terms, harms other
        users or exposes us to legal risk. Where a decision affects you, you may appeal it through the appeal form.
      </p>

      <h2>4. Practice content and no affiliation</h2>
      <p>
        {SITE_NAME} is an independent study tool. It is <strong>not affiliated with, endorsed by, or sponsored by</strong>{' '}
        the College Board, which owns the SAT, PSAT/NMSQT, PSAT 10 and PSAT 8/9 trademarks. All practice questions are
        written as original, standards-aligned practice items or are used under a license that permits it; see the
        Copyright &amp; Content Policy for provenance and licensing details.
      </p>
      <p>
        Practice scores, estimated score ranges and predictions are study aids only. They are not official scores and
        should not be relied on as predictions of any real assessment outcome.
      </p>

      <h2>5. Your content and feedback</h2>
      <p>
        You keep ownership of anything you write (for example notes on saved questions). You grant us a limited licence
        to store and display it back to you so the service can work. Reports, appeals and survey responses may be used
        on an aggregated basis to improve question quality. Do not send us confidential information.
      </p>

      <h2>6. Availability, changes and termination</h2>
      <ul>
        <li>The service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We may add, change, suspend or discontinue features.</li>
        <li>We may update these Terms. Material changes will be announced in the app and versioned on this page; continuing to use {SITE_NAME} after an update means you accept it.</li>
        <li>You may stop using the service at any time. Sections that by their nature survive termination (intellectual property, disclaimers, liability limits, governing law) continue to apply.</li>
      </ul>

      <h2>7. Disclaimers and limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, {OPERATOR_NAME} disclaims all implied warranties, including
        merchantability, fitness for a particular purpose and non-infringement. We do not warrant that content is
        error-free or that the service will be uninterrupted.
      </p>
      <p>
        To the fullest extent permitted by law, {OPERATOR_NAME} is not liable for indirect, incidental, special,
        consequential or punitive damages, or for lost data, lost profits or loss of goodwill. Where liability cannot
        be excluded, our total liability is limited to the greater of the amount you paid us in the twelve months
        before the claim or USD 50. Nothing here limits rights that consumer law gives you and cannot be waived.
      </p>

      <h2>8. Reporting problems and appeals</h2>
      <ul>
        <li><strong>Question problems:</strong> every question card has a &ldquo;Report a problem&rdquo; control that files a content report with the question id.</li>
        <li><strong>Safety, copyright, access and data requests:</strong> file an appeal with the form at the bottom of this page. You do not need an account.</li>
        <li>We aim to acknowledge safety and copyright reports within {APPEAL_SLA_HOURS} hours. Repeat, frivolous or abusive reports may be disregarded.</li>
      </ul>

      <h2>9. Governing law</h2>
      <p>{governingLawClause()}</p>
      <p>{venuesClause()} Nothing in this section prevents you from bringing a claim in a court where you are legally entitled to do so.</p>
      <p className="muted">Contact: {SUPPORT_EMAIL || `use the appeal form below to reach ${OPERATOR_NAME}`}.</p>
    </LegalShell>
  );
}

export function PrivacyPage() {
  const app = useApp();
  const cloud = app.mode === 'cloud';
  return (
    <LegalShell
      title="Privacy & Data Rights"
      intro={`This page explains what ${SITE_NAME} collects, why, how long we keep it, and how to get a copy of it or have it deleted. It applies to students, parents and guardians.`}
    >
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account details:</strong> email address and display name. Passwords are stored only as salted hashes by our authentication provider; we never see or store your password. Password-change timestamps, and a hashed record of confirmation and recovery emails, are kept so these actions can be rate-limited. Until you confirm your email address, your account stores your progress and scores but not the item-by-item answer history.</li>
        <li><strong>Age group and consent:</strong> a coarse age band (13–15, 16–17, 18+) and whether a parent or guardian consented, so we can apply the right privacy rules.</li>
        <li><strong>Practice activity:</strong> answers you submit, whether they were correct, time spent, attempt counts, streaks, study-day activity, flashcard scheduling, saved questions, HDCoins and unlocked cosmetics.</li>
        <li><strong>Reports you file:</strong> content reports and appeals, including any details and contact email you choose to give.</li>
        <li><strong>Preference settings:</strong> chosen assessment, display preferences and progress settings.</li>
      </ul>
      <p>
        <strong>We do not use advertising trackers, we do not build advertising profiles, and we do not sell personal
        data.</strong> We do not collect precise location, contacts, photos, or device fingerprints.
      </p>

      <h2>Guest mode</h2>
      <p>
        If you use {SITE_NAME} without signing in, your practice history is stored only in your own browser
        (<code>localStorage</code> key <code>hdsat.profile.v1</code>). It never reaches our servers unless you create an
        account and choose to sync it. Clearing your browser data removes it.
      </p>

      <h2>Why we use it, and the legal basis</h2>
      <ul>
        <li><strong>To provide the service</strong> — saving progress, grading answers, showing your statistics. Basis: performance of a contract.</li>
        <li><strong>To keep it safe and correct</strong> — reviewing content reports, preventing abuse, fixing mistakes. Basis: legitimate interests and, for minors, our child-safety obligations.</li>
        <li><strong>To honour your requests</strong> — access, correction, deletion and copyright notices. Basis: legal obligations and your rights.</li>
        <li><strong>With consent</strong> — where a parent or guardian has agreed to an account for someone under 18.</li>
      </ul>

      <h2>Children&apos;s privacy</h2>
      <ul>
        <li>{SITE_NAME} accounts are for users aged {MIN_AGE} and over. We do not knowingly collect personal information from children under {MIN_AGE}. If you believe a child under {MIN_AGE} has created an account, file a safety report and we will delete it.</li>
        <li>For users aged 13–17 we collect the minimum needed for the study features, apply the same no-advertising/no-sale rules above, and require parent or guardian consent at signup.</li>
        <li>Parents and guardians can ask to review, export or delete their child&apos;s data using the appeal form.</li>
      </ul>

      <h2>Who processes data for us</h2>
      <ul>
        <li><strong>Supabase</strong> hosts our authentication and database. Student records are isolated per user with row-level security, so one account cannot read another&apos;s rows.</li>
        <li><strong>PythonAnywhere</strong> serves the web application.</li>
        <li>We disclose personal data only where legally required, to protect rights and safety, or as part of a business transfer — never for advertising.</li>
      </ul>

      <h2>Data retention: how long we keep it</h2>
      <ul>
        <li>Practice history and account data: while your account is open, then deleted on request or after 24 months of inactivity.</li>
        <li>Content reports and appeals: kept while we investigate, then up to 24 months for audit and repeat-infringer records. Copyright records may be kept longer where the law requires.</li>
        <li>Deleted accounts are removed from the live database; encrypted backups rotate out within 30 days.</li>
      </ul>

      <h2>Your rights</h2>
      <p>Depending on where you live you may have some or all of these rights. We honour them for everyone:</p>
      <ul>
        <li><strong>Access and portability:</strong> download your data as JSON from <em>Account → Safety &amp; data rights</em>.</li>
        <li><strong>Deletion:</strong> delete your account and all associated rows from the same panel. This is self-serve and immediate.</li>
        <li><strong>Correction:</strong> fix your display name in Account, or ask us to correct anything else.</li>
        <li><strong>Objection and restriction:</strong> tell us what you object to and we will stop or restrict the processing unless we have a legal obligation to continue.</li>
        <li><strong>Withdraw consent:</strong> withdraw parent/guardian consent at any time; we will close the account.</li>
        <li><strong>Non-discrimination:</strong> we will not degrade the service because you exercised a right.</li>
      </ul>
      <p>To exercise a right, use the appeal form or email us. We respond within {APPEAL_SLA_HOURS} hours and complete verified requests within 30 days.</p>

      <h2>Security and cookies</h2>
      <ul>
        <li>All traffic is encrypted in transit. Database access is restricted by row-level security and least-privilege keys; exam answer keys are never exposed to the browser in bulk.</li>
        <li>{SITE_NAME} uses only storage essential to operate: an authentication session and, in guest mode, your local practice data. No analytics or advertising cookies.</li>
        <li>No system is perfectly secure. If we become aware of a breach affecting your data we will notify you and the relevant authorities as required.</li>
      </ul>

      <h2>Changes and contact</h2>
      <p>
        We version this page and announce material changes in the app. Currently stored on this device: current policy
        version {LEGAL_VERSION}, account mode <strong>{cloud ? 'cloud account' : 'guest (device only)'}</strong>.
      </p>
      <p className="muted">
        {SUPPORT_EMAIL ? `Email ${SUPPORT_EMAIL}.` : 'Use the appeal form below.'} Postal and regulator details are
        available on request.
      </p>
    </LegalShell>
  );
}

export function CopyrightPage() {
  return (
    <LegalShell
      title="Copyright & Content Policy"
      intro={`${SITE_NAME} publishes original, standards-aligned practice content and takes intellectual-property concerns seriously — including claims about material we publish and allegations of misuse of our material by others.`}
    >
      <h2>Where our practice content comes from</h2>
      <ul>
        <li>
          <strong>Original practice items.</strong> The overwhelming majority of questions, explanations, distractor
          rationales and flashcards are written for {SITE_NAME} against the publicly documented SAT Suite of
          Assessments content domains and skill taxonomy. They are our original expression of those skills, not
          reproductions of any official test.
        </li>
        <li>
          <strong>Licensed or openly licensed material.</strong> Where we use third-party material it is used under a
          licence that permits it, with attribution recorded per source. Every question card shows its source and
          licence.
        </li>
        <li>
          <strong>Public-domain and factual material.</strong> Passages and data in the public domain, and factual
          content such as formulae or definitions, may be used freely.
        </li>
      </ul>
      <p>
        <strong>We do not publish official College Board test questions.</strong> {SITE_NAME} is not affiliated with,
        endorsed by or sponsored by the College Board. SAT, PSAT/NMSQT, PSAT 10 and PSAT 8/9 are trademarks of the
        College Board, used only to describe what our practice material prepares students for.
      </p>

      <h2>If you believe we are infringing your rights (takedown notice)</h2>
      <p>
        Send a written notice using the appeal form below (choose <em>Copyright / content removal request</em>) or
        email us. To be actionable under the DMCA your notice should include:
      </p>
      <ul>
        <li>your physical or electronic signature;</li>
        <li>identification of the copyrighted work you say has been infringed;</li>
        <li>the exact URL or question id of the material you want removed, with enough detail for us to find it;</li>
        <li>your name, address, telephone number and email address;</li>
        <li>a statement that you have a good-faith belief the use is not authorized by the copyright owner, its agent or the law;</li>
        <li>a statement, under penalty of perjury, that the information in your notice is accurate and that you are the owner or authorized to act on the owner&apos;s behalf.</li>
      </ul>
      <p>
        We remove or disable access to material that is the subject of a compliant notice, typically within{' '}
        {APPEAL_SLA_HOURS} hours of receipt, and we notify the contributor where we have their details.
      </p>

      <h2>Counter-notice</h2>
      <p>
        If your material was removed and you believe it was lawful, you may send a counter-notice with your signature,
        identification of the removed material and its former location, a statement under penalty of perjury that you
        have a good-faith belief the material was removed by mistake or misidentification, and your contact details and
        consent to the jurisdiction of the appropriate court. We will forward it and may restore the material after the
        statutory waiting period unless the claimant files suit.
      </p>

      <h2>Repeat infringers and our own content</h2>
      <ul>
        <li>Accounts that repeatedly post infringing material may be suspended or terminated under these Terms.</li>
        <li>
          Questions, explanations, flashcards and study material on {SITE_NAME} are protected by copyright and may not
          be scraped, bulk-downloaded, republished, resold or used to train machine-learning models without our written
          permission. Copying individual items for personal study is fine.
        </li>
        <li>Course names, brands and trademarks remain the property of their respective owners.</li>
      </ul>

      <h2>Report an inaccurate or unsafe question</h2>
      <p>
        Content accuracy is a safety issue for students. If a question is wrong, mistagged or unsafe, report it from the
        question card (the &ldquo;Report a problem&rdquo; control records the question id automatically), or file an
        appeal here if you would prefer not to be signed in. Reports never change an item for other students until a
        reviewer verifies the fix.
      </p>
      <p className="muted">
        {SUPPORT_EMAIL
          ? `Notices may also be emailed to ${SUPPORT_EMAIL}.`
          : 'When a designated agent mailbox is configured for this deployment it will be published here; until then, file notices through the form below and we will respond to your contact address.'}
      </p>
    </LegalShell>
  );
}

export function CreditsPage() {
  const app = useApp();
  return (
    <LegalShell
      title="Credits & Attribution"
      support={false}
      started
      intro={`${SITE_NAME} is built and maintained by ${CREATOR_NAME} as an open, accessible Digital SAT and PSAT preparation platform.`}
    >
      <h2>Creator &amp; Official Links</h2>
      <ul>
        <li>
          <strong>Created by:</strong> {CREATOR_NAME}
        </li>
        <li>
          <strong>YouTube Channel:</strong>{' '}
          <a href={CREATOR_YOUTUBE_URL} target="_blank" rel="noopener noreferrer">
            @HyperHrishiHD ({CREATOR_YOUTUBE_URL})
          </a>
        </li>
        <li>
          <strong>Source Code &amp; Issue Tracker:</strong>{' '}
          <a href={CREATOR_GITHUB_URL} target="_blank" rel="noopener noreferrer">
            {CREATOR_GITHUB_URL}
          </a>
        </li>
      </ul>

      <h2>Question Bank &amp; Open Datasets</h2>
      <p>{app.licensingNote}</p>
      <ul>
        {app.sources.map((src) => (
          <li key={src.source_id}>
            <strong>{src.name}</strong> ({src.license}) — {src.provenance_summary}
          </li>
        ))}
      </ul>

      <h2>Open-Source Software &amp; Embedded Tools</h2>
      <ul>
        <li>
          <strong>Desmos Graphing Calculator:</strong> Embedded under the College Board Testing calculator configuration
          for authentic Digital SAT math practice.
        </li>
        <li>
          <strong>KaTeX:</strong> Fast math typesetting library (MIT License).
        </li>
        <li>
          <strong>React, Vite &amp; TypeScript:</strong> Frontend application framework and build toolchain (MIT License).
        </li>
        <li>
          <strong>Flask &amp; Supabase:</strong> Backend serving and PostgreSQL row-level security infrastructure.
        </li>
      </ul>

      <h2>Reporting Questions or Feedback</h2>
      <p>
        Found an issue with a question or want to suggest an improvement? Use the <strong>Report a problem</strong>{' '}
        button on any question card or submit the appeal form below.
      </p>

      <h2>The Starting Page</h2>
      <p className="muted">
        The full-page introduction a blank browser lands on. Nothing changes if you open it — it is
        the same page, with the same one-click way back in.
      </p>
      <p style={{ margin: 0 }}>
        <Link to="/welcome" className="btn btn-outline btn-sm">
          View the starting page
        </Link>
      </p>
    </LegalShell>
  );
}
