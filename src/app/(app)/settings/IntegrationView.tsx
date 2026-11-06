'use client'
// @atelier-migrated
// Intégration : lien direct, iframe et bouton flottant à coller sur le site de l'artisan.

import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import CopyButton from './CopyButton'
import { iframeSnippet, publicFormUrl, widgetSnippet } from './integrationModel'
import type { SettingsState } from './useSettings'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

function Snippet({ title, intro, code }: { title: string; intro: string; code: string }) {
  return (
    <section className={local.codeBlock}>
      <h2 className={local.sectionHeading}>{title}</h2>
      <p className={styles.hint} style={{ margin: '0 16px' }}>{intro}</p>
      <pre className={local.code} tabIndex={0} aria-label={title}>{code}</pre>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><CopyButton text={code} label="Copier le code" /></div>
    </section>
  )
}

export default function IntegrationView({ q }: { q: SettingsState }) {
  const url = publicFormUrl(q.appUrl, q.organization?.slug ?? '')
  return (
    <div className={local.detail}>
      <div className={local.sections}>
        <ListGroup title="Lien direct" description="À partager dans votre signature email, sur vos réseaux ou sur votre site.">
          <ListRow title="Formulaire de demande de devis" description={url} trailing={<CopyButton text={url} />} />
          <ListRow title="Ouvrir dans un nouvel onglet" href={url} target="_blank" rel="noopener noreferrer" />
        </ListGroup>
        <Snippet title="Intégration iframe" intro="Collez ce code HTML dans votre site pour afficher le formulaire directement dans la page." code={iframeSnippet(url)} />
        <Snippet title="Bouton flottant" intro="Ajoute un bouton sur votre site qui ouvre le formulaire dans un nouvel onglet. À coller juste avant la balise de fin de page </body>." code={widgetSnippet(url)} />
      </div>
    </div>
  )
}
