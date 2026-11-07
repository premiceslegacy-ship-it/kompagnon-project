// @atelier-migrated
'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AuthFooterLine, AuthLinkButton, AuthNotice } from '@/components/auth/AuthParts'
import LoginForm from './LoginForm'
import SignupForm from './SignupForm'

export default function AuthPage() {
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<'login' | 'signup'>(() => (searchParams.get('mode') === 'signup' ? 'signup' : 'login'))

  return (
    <AuthLayout
      title={mode === 'login' ? 'Bon retour' : 'Créer votre compte'}
      subtitle={mode === 'login' ? 'Connectez-vous à votre espace de travail.' : 'Une minute, puis votre espace est prêt.'}
    >
      {mode === 'login' && searchParams.get('session') === 'expired' && (
        <AuthNotice tone="warning">Votre session a expiré. Reconnectez-vous pour continuer.</AuthNotice>
      )}
      {mode === 'login' ? <LoginForm /> : <SignupForm />}
      <AuthFooterLine>
        {mode === 'login' ? (
          <>
            Pas encore de compte ? <AuthLinkButton onClick={() => setMode('signup')}>Créer un compte</AuthLinkButton>
          </>
        ) : (
          <>
            Déjà un compte ? <AuthLinkButton onClick={() => setMode('login')}>Se connecter</AuthLinkButton>
          </>
        )}
      </AuthFooterLine>
    </AuthLayout>
  )
}
