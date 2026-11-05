'use client'

import { Button } from '@/components/ui/Button'
import { CheckRow, ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Field } from '@/components/ui/Field'
import { SearchField } from '@/components/ui/SearchField'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { PublicError, PublicHeader, PublicNote, PublicPage, PublicSuccess, PublicTitle } from '@/components/public/PublicPage'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import { ProgressBar } from './components/ProgressBar'
import { MaterialCard } from './components/MaterialCard'
import { PrestationCard } from './components/PrestationCard'
import type { PublicLaborRate, PublicMaterial, PublicPrestationType } from './components/types'
import { usePublicQuoteRequest } from './usePublicQuoteRequest'

type Props = {
  orgSlug: string
  orgName: string
  logoUrl: string | null
  welcomeMessage: string | null
  materials: PublicMaterial[]
  laborRates: PublicLaborRate[]
  prestationTypes: PublicPrestationType[]
  customModeEnabled: boolean
  catalogContext: ResolvedCatalogContext
}

const STEP_TITLES = ['Qui êtes-vous ?', 'Votre projet', 'Le chantier', 'Récapitulatif']
const STEP_DESCRIPTIONS = [
  'Pour que l’équipe puisse vous recontacter rapidement et personnaliser votre devis.',
  'Sélectionnez ce dont vous avez besoin, même approximativement : on affine ensemble ensuite.',
  'Tout est optionnel ici : renseignez ce qui est pertinent pour votre projet.',
  'Vérifiez vos informations avant d’envoyer.',
]
const CLIENT_TYPES = [
  { value: 'particulier', label: 'Particulier' },
  { value: 'pro', label: 'Professionnel' },
] as const

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count > 1 ? plural : singular}`
}

export default function PublicFormClient({
  orgSlug, orgName, logoUrl, welcomeMessage,
  materials, laborRates, prestationTypes, customModeEnabled, catalogContext,
}: Props) {
  const { fileInputRef, ...form } = usePublicQuoteRequest({ orgSlug, materials, laborRates, prestationTypes, catalogContext })
  const { step } = form
  const labels = catalogContext.labelSet

  if (form.success) {
    return (
      <PublicPage wide>
        <PublicHeader name={orgName} logoUrl={logoUrl} />
        <PublicSuccess
          title="Demande envoyée"
          description={`Merci${form.name.split(' ')[0] ? ` ${form.name.split(' ')[0]}` : ''}, votre demande est bien arrivée chez ${orgName}.`}
        >
          <ListGroup title="La suite">
            <ListRow title="Votre demande est étudiée par l’équipe." />
            <ListRow title={`Vous êtes recontacté à l’adresse ${form.email}${form.phone ? ' ou par téléphone' : ''}.`} />
            <ListRow title="Après étude, vous recevez un devis chiffré à accepter et signer en ligne." />
          </ListGroup>
          <div className="mt-espace-20">
            <Button size="lg" variant="secondary" className="w-full" onClick={() => window.location.reload()}>
              Envoyer une autre demande
            </Button>
          </div>
        </PublicSuccess>
      </PublicPage>
    )
  }

  const catalogSections = [
    { key: 'prestations', kindLabel: labels.bundleTemplate.plural, singular: 'prestation', plural: 'prestations', groups: form.filteredPrestationGroups },
    { key: 'services', kindLabel: labels.service.plural, singular: 'service', plural: 'services', groups: form.serviceMaterialGroups },
    { key: 'articles', kindLabel: labels.material.plural, singular: 'article', plural: 'articles', groups: form.articleMaterialGroups },
  ] as const
  const noSearchResult = form.hasCatalog && form.step2Q
    && form.articleMaterialGroups.length === 0 && form.serviceMaterialGroups.length === 0
    && form.laborRateGroups.length === 0 && form.filteredPrestationGroups.length === 0
  const selectedPrestationTypes = prestationTypes.filter(pt => form.selectedPrestations[pt.id])
  const selectedMaterialList = Object.values(form.selectedMaterials)
  const stepError = step === 1 ? form.step1Error : step === 2 ? form.step2Error : step === 4 ? form.submitError : null

  return (
    <PublicPage wide>
      <PublicHeader name={orgName} logoUrl={logoUrl} />
      <PublicTitle description={welcomeMessage ?? undefined}>Demande de devis</PublicTitle>
      <p className="mx-espace-4 mb-[14px] mt-0 flex flex-wrap gap-x-[14px] gap-y-[6px] text-note font-atelier-medium text-encre-2">
        <span>Réponse sous 48 h ouvrées</span>
        <span>Sans engagement</span>
        <span>2 minutes chrono</span>
      </p>

      <ProgressBar step={step} />
      <h2 className="mx-espace-4 mb-0 mt-[18px] text-titre-2 font-atelier-bold">{STEP_TITLES[step - 1]}</h2>
      <p className="mx-espace-4 mb-[14px] mt-espace-4 text-sous-titre text-encre-2 [text-wrap:pretty]">{STEP_DESCRIPTIONS[step - 1]}</p>

      {step === 1 && (
        <>
          <div className="mt-espace-4">
            <SegmentedControl
              label="Vous êtes"
              options={CLIENT_TYPES}
              value={form.clientType}
              onChange={value => form.setClientType(value as 'particulier' | 'pro')}
              fullWidth
            />
          </div>
          <ListGroup>
            <li className="border-b border-trait">
              <Field type="text" label="Nom complet" value={form.name} onChange={e => form.setName(e.currentTarget.value)} placeholder="Jean Dupont" autoComplete="name" required />
            </li>
            <li className="border-b border-trait">
              <Field type="email" label="Email" value={form.email} onChange={e => form.setEmail(e.currentTarget.value)} placeholder="jean@exemple.fr" autoComplete="email" inputMode="email" required />
            </li>
            <li className={form.clientType === 'pro' ? 'border-b border-trait' : undefined}>
              <Field type="tel" label="Téléphone" value={form.phone} onChange={e => form.setPhone(e.currentTarget.value)} placeholder="06 12 34 56 78" autoComplete="tel" inputMode="tel" />
            </li>
            {form.clientType === 'pro' && (
              <>
                <li className="border-b border-trait">
                  <Field type="text" label="Entreprise" value={form.companyName} onChange={e => form.setCompanyName(e.currentTarget.value)} placeholder="Dupont Rénovation" autoComplete="organization" required />
                </li>
                <li>
                  <Field type="text" label="SIRET" value={form.siret} onChange={e => form.setSiret(e.currentTarget.value)} placeholder="123 456 789 00012" maxLength={17} />
                </li>
              </>
            )}
          </ListGroup>
          <PublicNote>Nom, email{form.clientType === 'pro' ? ' et entreprise' : ''} obligatoires.</PublicNote>
        </>
      )}

      {step === 2 && (
        <>
          {form.hasCatalog && (
            <SearchField label="Rechercher dans le catalogue" value={form.step2Search} onChange={form.setStep2Search} placeholder="Rechercher dans le catalogue" />
          )}
          {noSearchResult && <PublicNote>Aucun résultat pour «&nbsp;{form.step2Search}&nbsp;».</PublicNote>}

          {catalogSections.map(section => section.groups.map((group, groupIndex) => {
            const key = `${section.key}-${group.label}`
            const isPrestation = section.key === 'prestations'
            const items = group.items as Array<PublicPrestationType | PublicMaterial>
            const selCount = items.filter(item => isPrestation ? !!form.selectedPrestations[item.id] : !!form.selectedMaterials[item.id]).length
            const isOpen = !!form.step2Q || selCount > 0 || form.expandedCategories.has(key)
            return (
              <ListGroup key={key} title={groupIndex === 0 ? section.kindLabel : undefined}>
                <ListRow
                  title={group.label}
                  description={`${countLabel(group.items.length, section.singular, section.plural)}${selCount ? ` · ${countLabel(selCount, 'sélectionné', 'sélectionnés')}` : ''}`}
                  onClick={() => form.toggleCategory(key)}
                  trailing={<span className="text-note text-encre-2">{isOpen ? 'Masquer' : 'Afficher'}</span>}
                />
                {isOpen && items.map(item => isPrestation ? (
                  <CheckRow
                    key={item.id}
                    title={(item as PublicPrestationType).name}
                    description={(item as PublicPrestationType).description ?? undefined}
                    checked={!!form.selectedPrestations[item.id]}
                    onCheckedChange={() => form.togglePrestation(item as PublicPrestationType)}
                  />
                ) : (
                  <CheckRow
                    key={item.id}
                    title={(item as PublicMaterial).name}
                    description={(item as PublicMaterial).description ?? undefined}
                    checked={!!form.selectedMaterials[item.id]}
                    onCheckedChange={() => form.toggleMaterial(item as PublicMaterial)}
                  />
                ))}
              </ListGroup>
            )
          }))}

          {!form.hasCatalog && !customModeEnabled && (
            <PublicNote>
              {labels.bundleTemplate.emptyLabel}. L’entreprise configurera bientôt les {labels.bundleTemplate.plural.toLowerCase()} proposées ici.
            </PublicNote>
          )}

          {(selectedMaterialList.length > 0 || selectedPrestationTypes.length > 0) && (
            <>
              <h3 className="mx-espace-4 mb-0 mt-espace-32 text-titre-3 font-atelier-medium">Votre sélection</h3>
              <PublicNote>Précisez les quantités ou les dimensions, même approximatives.</PublicNote>
              {selectedPrestationTypes.map(pt => (
                <PrestationCard
                  key={pt.id}
                  pt={pt}
                  data={form.selectedPrestations[pt.id]}
                  onLineSetQty={(lineId, q) => form.setPrestationLineExactQty(pt.id, lineId, q)}
                  onLineSetDimensionCount={(lineId, q) => form.setPrestationLineDimensionCount(pt.id, lineId, q)}
                  onLineSetDetails={(lineId, d) => form.setPrestationLineDetails(pt.id, lineId, d)}
                  onLineSetLength={(lineId, v) => form.setPrestationLineLength(pt.id, lineId, v)}
                  onLineSetWidth={(lineId, v) => form.setPrestationLineWidth(pt.id, lineId, v)}
                  onLineSetHeight={(lineId, v) => form.setPrestationLineHeight(pt.id, lineId, v)}
                  onLineRemove={lineId => form.removePrestationLine(pt.id, lineId)}
                  onLineAdd={line => form.addPrestationLine(pt.id, line)}
                />
              ))}
              {selectedMaterialList.map(m => (
                <MaterialCard
                  key={m.id}
                  material={m}
                  kindLabel={m.item_kind === 'service' ? labels.service.singular : labels.material.singular}
                  onSetQty={q => form.setMaterialExactQty(m.id, q)}
                  onSetDimensionCount={q => form.setMaterialDimensionCount(m.id, q)}
                  onSetDetails={d => form.setMaterialDetails(m.id, d)}
                  onSetLength={v => form.setMaterialLength(m.id, v)}
                  onSetWidth={v => form.setMaterialWidth(m.id, v)}
                  onSetHeight={v => form.setMaterialHeight(m.id, v)}
                />
              ))}
            </>
          )}

          {(customModeEnabled || !form.hasCatalog) && (
            <ListGroup description={form.hasCatalog ? 'Facultatif si vous avez sélectionné des éléments.' : undefined}>
              <li>
                <Field
                  type="textarea"
                  label={form.hasCatalog ? 'Autre besoin' : 'Description du projet'}
                  rows={4}
                  value={form.freeDescription}
                  onChange={e => form.setFreeDescription(e.currentTarget.value)}
                  placeholder="Décrivez votre besoin : type de travaux, dimensions, contraintes, délais souhaités…"
                />
              </li>
            </ListGroup>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <ListGroup title="Adresse du chantier">
            <li className="border-b border-trait">
              <Field type="text" label="Adresse" value={form.chantierAddress} onChange={e => form.setChantierAddress(e.currentTarget.value)} placeholder="Numéro et rue" autoComplete="address-line1" />
            </li>
            <li className="border-b border-trait">
              <Field type="text" label="Code postal" value={form.chantierPostalCode} onChange={e => form.setChantierPostalCode(e.currentTarget.value)} placeholder="69003" autoComplete="postal-code" inputMode="numeric" />
            </li>
            <li>
              <Field type="text" label="Ville" value={form.chantierCity} onChange={e => form.setChantierCity(e.currentTarget.value)} placeholder="Lyon" autoComplete="address-level2" />
            </li>
          </ListGroup>
          <ListGroup title="Informations complémentaires">
            <li>
              <Field type="textarea" label="Précisions" rows={3} value={form.extraNotes} onChange={e => form.setExtraNotes(e.currentTarget.value)} placeholder="Contraintes d’accès, délais souhaités, précisions techniques…" />
            </li>
          </ListGroup>
          <ListGroup title="Fichier joint" description="Photo, plan, PDF : 10 Mo au maximum. Facultatif.">
            {form.isUploading ? (
              <ListRow title={form.attachmentFile?.name ?? 'Fichier'} description="Envoi en cours…" />
            ) : form.attachmentFile ? (
              <ListRow
                title={form.attachmentFile.name}
                description="Joint à votre demande"
                trailing={
                  <Button size="sm" variant="secondary" onClick={form.removeAttachment}>
                    Retirer
                  </Button>
                }
              />
            ) : (
              <ListRow title="Joindre un fichier" onClick={() => fileInputRef.current?.click()} />
            )}
          </ListGroup>
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.dwg,.dxf"
            onChange={form.handleFileChange}
          />
          <PublicError>{form.fileError}</PublicError>
        </>
      )}

      {step === 4 && (
        <>
          <ListGroup>
            {form.recapItems.map(item => (
              <ListRow key={item.label} title={item.label} description={item.value || 'Non renseigné'} />
            ))}
          </ListGroup>
          <PublicNote>Vos données sont transmises uniquement à {orgName} et ne sont pas partagées avec des tiers.</PublicNote>
        </>
      )}

      <PublicError>{stepError}</PublicError>

      {/* Champ piège anti-robot : invisible, ne pas remplir. */}
      <div aria-hidden="true" className="pointer-events-none absolute -left-[9999px] opacity-0">
        <label htmlFor="_hp_website">Ne pas remplir ce champ</label>
        <input id="_hp_website" type="text" value={form.honeypot} onChange={e => form.setHoneypot(e.target.value)} autoComplete="off" tabIndex={-1} />
      </div>

      <div className="mt-[22px] flex items-center justify-between gap-[10px]">
        {step > 1 ? (
          <Button variant="secondary" onClick={form.goBack} disabled={form.isPending}>Retour</Button>
        ) : <span />}
        {step < 4 ? (
          <Button onClick={form.goNext}>
            {step === 2 && form.selectionCount > 0 ? `Continuer (${form.selectionCount})` : 'Continuer'}
          </Button>
        ) : (
          <Button onClick={form.handleSubmit} disabled={form.isUploading} loading={form.isPending} loadingText="Envoi…">
            Envoyer la demande
          </Button>
        )}
      </div>
    </PublicPage>
  )
}
