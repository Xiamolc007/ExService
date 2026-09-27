import { Link, useLocation } from 'react-router'
import { Button, Card } from '@exre/exui'
import { ArrowLeftIcon } from 'lucide-react'
import { InvitationRegistrationFlow } from '../../invitations/InvitationRegistrationFlow'
import { AuthBackdrop } from './AuthBackdrop'
import styles from './AuthPage.module.scss'

export function InvitationRegistrationPage() {
  const location = useLocation()
  const initialEmail = (location.state as { email?: unknown } | null)?.email
  return <main className={styles.page} data-page="auth"><AuthBackdrop />
    <Button asChild variant="ghost" className={styles.homeLink}><Link to="/"><ArrowLeftIcon aria-hidden="true" /> Home</Link></Button>
    <Card glass className={styles.panel} data-auth-mode="register">
      <InvitationRegistrationFlow presentation="page" initialEmail={typeof initialEmail === 'string' ? initialEmail : ''} />
      <p className={styles.legal}>By signing up, you agree to our Terms, Acceptable Use, and Privacy Policy.</p>
    </Card>
  </main>
}
