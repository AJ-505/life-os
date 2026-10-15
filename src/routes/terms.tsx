import { createFileRoute } from '@tanstack/react-router'

import { LegalPage } from '#/legal/LegalPage'

export const Route = createFileRoute('/terms')({
  component: Terms,
})

function Terms() {
  return (
    <LegalPage title="Terms of service" updated="15 October 2026">
      <p>
        By using Life OS you agree to these terms. They are short on purpose.
      </p>
      <section>
        <h2>The service</h2>
        <p>
          Life OS is a free personal project and task board, with optional
          shared spaces and optional Google Calendar sync. It is provided as is,
          without warranty. Features can change or stop.
        </p>
      </section>
      <section>
        <h2>Your content</h2>
        <p>
          What you put in Life OS stays yours. You give us permission to store
          it and show it to you and to the people in spaces you share. You are
          responsible for what you share with others.
        </p>
      </section>
      <section>
        <h2>Fair use</h2>
        <p>
          Do not use Life OS to break the law, to harm others, or to attack or
          overload the service. We can suspend accounts that do.
        </p>
      </section>
      <section>
        <h2>Liability</h2>
        <p>
          Keep your own backups with the export button. To the extent the law
          allows, Life OS is not liable for lost data, missed deadlines or other
          indirect loss.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>
          Questions go to{' '}
          <a href="mailto:abasiono.mbat@gmail.com">abasiono.mbat@gmail.com</a>.
          See also the <a href="/privacy">privacy policy</a>.
        </p>
      </section>
    </LegalPage>
  )
}
