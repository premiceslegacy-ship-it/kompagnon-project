'use client'
// @atelier-migrated
// Réglages : liste groupée à la manière des Réglages iOS, puis un écran de détail par entrée.

import { useCallback, useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, ChevronLeft, FileText, KeyRound, Link2, Lock, Mail, MessageSquare, Receipt, Shield, ShieldCheck, Star, User, Users, Wallet } from 'lucide-react'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { createClient } from '@/lib/supabase/client'
import AbonnementView from './AbonnementView'
import DevisView from './DevisView'
import DonneesView from './DonneesView'
import EinvoicingView from './EinvoicingView'
import EntrepriseView from './EntrepriseView'
import EquipeView from './EquipeView'
import FormulaireView from './FormulaireView'
import IntegrationView from './IntegrationView'
import LegalView from './LegalView'
import PaiementView from './PaiementView'
import RelancesView from './RelancesView'
import RolesView from './RolesView'
import ProfilView from './ProfilView'
import SecuriteView from './SecuriteView'
import { firstOrgError } from './entrepriseModel'
import { canOpenTab, fullName, groupTitleOf, isSettingsTab, settingsGroups, type SettingsEntry, type SettingsTab } from './settingsModel'
import { useSettings, type SettingsProps, type SettingsState } from './useSettings'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

const VIEWS: Record<SettingsTab, (props: { q: SettingsState }) => ReactNode> = {
  profil: ProfilView, securite: SecuriteView, entreprise: EntrepriseView, legal: LegalView, paiement: PaiementView,
  devis: DevisView, emails: RelancesView, formulaire: FormulaireView, integration: IntegrationView,
  equipe: EquipeView, roles: RolesView, abonnement: AbonnementView, facturation: EinvoicingView, confidentialite: DonneesView,
}

/** Chaque écran porte ses propres états : il est rendu comme composant, jamais appelé comme fonction. */
function DetailView({ tab, q }: { tab: SettingsTab; q: SettingsState }) {
  const View = VIEWS[tab]
  return <View q={q} />
}

const ICONS: Record<SettingsEntry['icon'], typeof User> = {
  user: User, lock: Lock, building: Building2, insurance: ShieldCheck, wallet: Wallet, document: FileText, mail: Mail, message: MessageSquare, link: Link2,
  users: Users, key: KeyRound, star: Star, invoice: Receipt, shield: Shield,
}

export default function SettingsClient(props: SettingsProps) {
  const q = useSettings(props)
  const router = useRouter()
  const access = {
    canEditOrg: props.canEditOrg,
    canEditRoles: props.canEditRoles,
    canConfigureEinvoicing: props.canConfigureEinvoicing,
    isOwner: props.currentRoleSlug === 'owner',
  }
  const counts = { members: props.members.length, roles: props.roles.length }
  const tab: SettingsTab | null = isSettingsTab(q.activeTab) && canOpenTab(q.activeTab, access, counts) ? q.activeTab : null
  const groups = settingsGroups(access, counts)
  const entry = tab ? groups.flatMap(g => g.entries).find(e => e.tab === tab) : null

  // Le bouton retour du navigateur ramène à la liste ou à l'écran précédent.
  useEffect(() => {
    const onPop = () => { const t = new URLSearchParams(window.location.search).get('tab'); q.setActiveTab(t && isSettingsTab(t) ? t : null) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const open = useCallback((next: SettingsTab | null) => {
    q.setActiveTab(next)
    window.history.pushState(null, '', next ? `/settings?tab=${next}` : '/settings')
    window.scrollTo(0, 0)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Une erreur de saisie sur un autre écran Entreprise : on y va et on place le curseur sur le champ.
  useEffect(() => {
    const first = firstOrgError(q.orgFieldErrors)
    if (!first) return
    if (first.tab !== tab) open(first.tab)
    const timer = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-org-field="${first.field}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.focus()
    }, 80)
    return () => window.clearTimeout(timer)
  }, [q.orgFieldErrors]) // eslint-disable-line react-hooks/exhaustive-deps

  async function signOut() {
    await createClient().auth.signOut({ scope: 'local' })
    router.replace('/login')
    router.refresh()
  }

  const who = fullName(q.profileFields) || q.profileFields.email

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        {entry && tab ? (
          <>
            <button type="button" className={styles.back} onClick={() => open(null)}>
              <ChevronLeft size={20} aria-hidden="true" />
              Réglages
            </button>
            <header className={screen.header}>
              <div>
                <p className={screen.kicker}>{groupTitleOf(tab, access, counts)}</p>
                <h1 className={screen.title}>{entry.title}</h1>
              </div>
            </header>
            <div className={local.detail}><DetailView tab={tab} q={q} /></div>
          </>
        ) : (
          <>
            <header className={screen.header}>
              <div>
                <p className={screen.kicker}>{[who, props.organization?.name].filter(Boolean).join(' · ')}</p>
                <h1 className={screen.title}>Réglages</h1>
              </div>
            </header>
            <div className={styles.stack}>
              {groups.map(g => (
                <ListGroup key={g.title} title={g.title}>
                  {g.entries.map(e => {
                    const Icon = ICONS[e.icon]
                    return <ListRow key={e.tab} leading={<span className={local.tile}><Icon size={18} aria-hidden="true" /></span>} title={e.title} description={e.description} onClick={() => open(e.tab)} />
                  })}
                </ListGroup>
              ))}
              <ListGroup description="Certains réglages dépendent de votre rôle.">
                <li className={styles.destructiveRow}><button type="button" onClick={() => void signOut()}>Se déconnecter</button></li>
              </ListGroup>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
