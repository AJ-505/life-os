import { createFileRoute } from '@tanstack/react-router'

import { LegalPage } from '#/legal/LegalPage'

export const Route = createFileRoute('/privacy')({
  component: Privacy,
})

function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="15 October 2026">
      <p>
        Life OS is a personal task board. This page says what data it keeps,
        why, and who else sees it.
      </p>
      <section>
        <h2>What we keep</h2>
        <ul>
          <li>
            Your account: name, email address and profile picture from the
            Google account you sign in with. Clerk handles sign-in.
          </li>
          <li>
            What you write in the app: projects, tasks, notes, due dates,
            reminders, spaces and who is in them.
          </li>
          <li>Your settings, such as your time zone and default reminder.</li>
        </ul>
      </section>
      <section>
        <h2>Google Calendar</h2>
        <p>
          Calendar access is optional. If you turn on calendar sync, Life OS
          asks Google for the <code>calendar.events</code> permission. It uses
          it only to create, change and remove the events for tasks you mark
          &quot;Add to calendar&quot;. It does not read your other events. The
          Google access token stays on our servers and is never sent to your
          browser. Turning sync off removes the events Life OS made.
        </p>
        <p>
          Life OS&apos;s use of information received from Google APIs adheres to
          the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </section>
      <section>
        <h2>Who processes it</h2>
        <ul>
          <li>Clerk, for sign-in and account management.</li>
          <li>Convex, which stores the app data.</li>
          <li>Vercel, which serves the website.</li>
          <li>Google, when you use Google sign-in or calendar sync.</li>
        </ul>
        <p>
          We do not sell your data, show ads, or share it with anyone else.
          People in a space you join see that space&apos;s projects and tasks,
          and your name.
        </p>
      </section>
      <section>
        <h2>Your control</h2>
        <p>
          You can export everything as a backup file from the sidebar, delete
          any project or task, and leave or delete a space. To delete your
          account and all its data, email{' '}
          <a href="mailto:abasiono.mbat@gmail.com">abasiono.mbat@gmail.com</a>.
          You can remove Life OS&apos;s Google access at any time at{' '}
          <a href="https://myaccount.google.com/permissions">
            myaccount.google.com/permissions
          </a>
          .
        </p>
      </section>
    </LegalPage>
  )
}
