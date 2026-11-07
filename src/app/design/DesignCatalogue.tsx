'use client';

// @atelier-migrated
import { useEffect, useId, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ListGroup, ListRow, CheckRow } from '@/components/ui/ListGroup';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Switch } from '@/components/ui/Switch';
import { FilterChips } from '@/components/ui/FilterChips';
import { SearchField } from '@/components/ui/SearchField';
import { Avatar } from '@/components/ui/Avatar';
import { StatusPill } from '@/components/ui/StatusPill';
import { StatTile } from '@/components/ui/StatTile';
import { Sheet } from '@/components/ui/Sheet';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Menu } from '@/components/ui/Menu';
import { Hud } from '@/components/ui/Hud';
import { Dock } from '@/components/ui/Dock';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { AssistantField } from '@/components/ui/AssistantField';
import { SignaturePad } from '@/components/ui/SignaturePad';
import styles from './DesignCatalogue.module.css';

type Dataset = 'example' | 'empty' | 'long';
type ComponentState = 'idle' | 'disabled' | 'loading' | 'error';
const DOCUMENT_OPTIONS = [
  { value: 'quotes', label: 'Devis' },
  { value: 'invoices', label: 'Factures' },
  { value: 'suppliers', label: 'Reçues' },
];
const FILTER_OPTIONS = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'pending', label: 'En attente' },
  { value: 'signed', label: 'Signé' },
];
const LONG_DOCUMENT_OPTIONS = DOCUMENT_OPTIONS.map((option) => ({ ...option, label: `${option.label} ${option.label}` }));
const LONG_FILTER_OPTIONS = FILTER_OPTIONS.map((option) => ({ ...option, label: `${option.label} ${option.label}` }));
const SUGGESTIONS = ['Salle de bain', 'Terrasse bois'];
const NAME = 'Dupont Rénovation';
const DESCRIPTION = 'Dépose carrelage et ragréage';
const LONG_MENU_LABELS = {
  modify: 'Modifier Modifier Modifier Modifier Modifier Modifier Modifier Modifier Modifier Modifier Modifier Modifier Modifier Modifier Modifier Modifier',
  duplicate: 'Dupliquer Dupliquer Dupliquer Dupliquer Dupliquer Dupliquer Dupliquer Dupliquer Dupliquer Dupliquer Dupliquer Dupliquer Dupliquer Dupliquer Dupliquer Dupliquer',
  remove: 'Supprimer Supprimer Supprimer Supprimer Supprimer Supprimer Supprimer Supprimer Supprimer Supprimer Supprimer Supprimer Supprimer Supprimer Supprimer Supprimer',
};

export function DesignCatalogue() {
  const { setTheme } = useTheme();
  const remindersSwitchId = useId();
  const guardSwitchId = useId();
  const [dataset, setDataset] = useState<Dataset>('example');
  const [state, setState] = useState<ComponentState>('idle');
  const [text, setText] = useState(NAME);
  const [quantity, setQuantity] = useState<number | null>(12);
  const [unit, setUnit] = useState('m²');
  const [notes, setNotes] = useState(DESCRIPTION);
  const [segment, setSegment] = useState('quotes');
  const [fullWidthSegments, setFullWidthSegments] = useState(false);
  const [filters, setFilters] = useState<string[]>(['draft']);
  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [keepSheetOpen, setKeepSheetOpen] = useState(false);
  const [nested, setNested] = useState(false);
  const [alert, setAlert] = useState(false);
  const [itemVisible, setItemVisible] = useState(true);
  const [archiveVisible, setArchiveVisible] = useState(true);
  const [hud, setHud] = useState<'success' | 'error' | null>(null);
  const [listError, setListError] = useState(true);
  const [assistant, setAssistant] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState('');
  const removeAfterClose = useRef(false);
  const overlayHeadingRef = useRef<HTMLHeadingElement>(null);
  const alertNeedsFallbackFocus = useRef(false);
  useEffect(() => {
    if (!alert && alertNeedsFallbackFocus.current) {
      alertNeedsFallbackFocus.current = false;
      overlayHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [alert]);
  const disabled = state === 'disabled';
  const loading = state === 'loading';
  const error = state === 'error' ? "Il manque la fin de l'adresse, par exemple .fr" : undefined;
  const name = dataset === 'empty' ? '' : dataset === 'long' ? `${NAME} ${NAME}` : NAME;
  const description = dataset === 'long' ? `${DESCRIPTION}. ${DESCRIPTION}.` : DESCRIPTION;
  const actionLabel = dataset === 'long' ? 'Envoyer le devis Envoyer le devis' : 'Envoyer le devis';

  function changeDataset(value: Dataset) {
    setDataset(value);
    setText(value === 'empty' ? '' : value === 'long' ? `${NAME} ${NAME}` : NAME);
    setNotes(value === 'empty' ? '' : value === 'long' ? `${DESCRIPTION}. ${DESCRIPTION}.` : DESCRIPTION);
    setQuantity(value === 'empty' ? null : 12);
    setItemVisible(value !== 'empty');
    setArchiveVisible(value !== 'empty');
  }

  function changeSheet(open: boolean) {
    if (!open && keepSheetOpen) return;
    setSheet(open);
    if (!open) setNested(false);
  }

  function finishRemoveLine() {
    removeAfterClose.current = false;
    setItemVisible(false);
    setHud('success');
  }

  function removeLine() {
    if (sheet) {
      if (keepSheetOpen) return;
      removeAfterClose.current = true;
      changeSheet(false);
    } else {
      finishRemoveLine();
    }
  }

  const menuItems = [
    { label: dataset === 'long' ? LONG_MENU_LABELS.modify : 'Modifier', icon: <Pencil size={20} strokeWidth={1.6} />, onSelect: () => setLastAction('Modifier'), disabled: disabled || loading },
    { label: dataset === 'long' ? LONG_MENU_LABELS.duplicate : 'Dupliquer', icon: <Copy size={20} strokeWidth={1.6} />, onSelect: () => setLastAction('Dupliquer'), disabled: disabled || loading },
    { label: dataset === 'long' ? LONG_MENU_LABELS.remove : 'Supprimer', icon: <Trash2 size={20} strokeWidth={1.6} />, onSelect: removeLine, destructive: true, disabled: disabled || loading },
  ];

  return (
    <main className={styles.page} data-exemple="true">
      <header className={styles.header}>
        <h1>Composants</h1>
        <p>Catalogue de développement. Données d’exemple uniquement, sans enregistrement dans la base.</p>
        <div className={styles.examples} aria-label="Thème du catalogue">
          <Button variant="text" onClick={() => setTheme('light')}>Clair</Button>
          <Button variant="text" onClick={() => setTheme('dark')}>Sombre</Button>
          <Button variant="text" onClick={() => setTheme('system')}>Système</Button>
        </div>
      </header>
      <div className={styles.controls}>
        <Field type="select" label="Données" value={dataset} onChange={(event) => changeDataset(event.currentTarget.value as Dataset)}>
          <option value="example">Exemple</option><option value="empty">Vide</option><option value="long">Texte long</option>
        </Field>
        <Field type="select" label="État" value={state} onChange={(event) => setState(event.currentTarget.value as ComponentState)}>
          <option value="idle">Au repos</option><option value="disabled">Désactivé</option><option value="loading">Chargement</option><option value="error">Erreur</option>
        </Field>
        <Field type="select" label="Segments" value={fullWidthSegments ? 'full' : 'compact'} onChange={(event) => setFullWidthSegments(event.currentTarget.value === 'full')}>
          <option value="compact">Compacts</option><option value="full">Pleine largeur</option>
        </Field>
      </div>
      <output className={styles.output} aria-live="polite">{lastAction ? `Action locale : ${lastAction}` : 'Aucune action locale'}</output>

      <section className={styles.section} id="buttons" aria-labelledby="buttons-title">
        <h2 id="buttons-title">Button</h2>
        <p>Les variantes sont réunies ici pour leur vérification. Elles ne représentent pas un écran métier.</p>
        <div className={styles.examples}>
          <Button disabled={disabled} loading={loading} onClick={() => setLastAction('Envoyer le devis')}>{actionLabel}</Button>
          <Button variant="secondary" disabled={disabled} loading={loading} onClick={() => setLastAction('Enregistrer')}>Enregistrer</Button>
          <Button variant="text" disabled={disabled} onClick={() => setLastAction('Annuler')}>Annuler</Button>
          <Button variant="destructive" disabled={disabled} onClick={removeLine}>Supprimer</Button>
        </div>
        <div className={styles.examples}>
          <Button size="sm" onClick={() => setLastAction('Modifier')}>Modifier</Button>
          <Button size="md" onClick={() => setLastAction('Enregistrer')}>Enregistrer</Button>
          <Button size="lg" onClick={() => setLastAction('Envoyer le devis')}>Envoyer le devis</Button>
        </div>
      </section>

      <section className={styles.section} id="lists" aria-labelledby="lists-title">
        <h2 id="lists-title">ListGroup, ListRow et CheckRow</h2>
        <ListGroup headingLevel={3} title="Clients" description="Données d’exemple">
          {itemVisible ? <ListRow title={name} description={description} leading={<Avatar name={name} />} trailing={<StatusPill status="wait">En attente</StatusPill>} onClick={() => setLastAction('Clients')} disabled={disabled || loading} /> : <li><EmptyState headingLevel={4} title="Aucun client" description="Ajoutez votre premier client." /></li>}
          <CheckRow title={description} description="Salle de bain" checked={checked} onCheckedChange={setChecked} disabled={disabled || loading} />
        </ListGroup>
      </section>

      <section className={styles.section} id="fields" aria-labelledby="fields-title">
        <h2 id="fields-title">Field</h2>
        <div className={styles.fields}>
          <Field type="text" label={dataset === 'long' ? 'Nom du client Nom du client' : 'Client'} value={text} onChange={(event) => setText(event.currentTarget.value)} placeholder={NAME} hint={description} error={error} disabled={disabled} loading={loading} />
          <Field type="number" label="Quantité" value={quantity} onChange={setQuantity} min={0} decimals={2} allowEmpty error={error} disabled={disabled} loading={loading} />
          <Field type="select" label="Unité" value={unit} onChange={(event) => setUnit(event.currentTarget.value)} error={error} disabled={disabled} loading={loading}>
            <option value="m²">m²</option><option value="forfait">forfait</option><option value="u">u</option>
          </Field>
        </div>
        <Field type="textarea" label="Description" value={notes} onChange={(event) => setNotes(event.currentTarget.value)} error={error} disabled={disabled} loading={loading} />
      </section>

      <section className={styles.section} id="controls" aria-labelledby="controls-title">
        <h2 id="controls-title">SegmentedControl, Switch, FilterChips et SearchField</h2>
        <div className={styles.stack}>
          <SegmentedControl label="Documents" options={dataset === 'long' ? LONG_DOCUMENT_OPTIONS : DOCUMENT_OPTIONS} value={segment} onChange={setSegment} fullWidth={fullWidthSegments} disabled={disabled} loading={loading} error={error} />
          <div className={styles.switchRow}>
            <label htmlFor={remindersSwitchId}>Relances automatiques</label>
            <Switch id={remindersSwitchId} label="Relances automatiques" checked={enabled} onChange={setEnabled} disabled={disabled} loading={loading} error={error} />
          </div>
          <FilterChips label="Statut des documents" options={dataset === 'long' ? LONG_FILTER_OPTIONS : FILTER_OPTIONS} value={filters} onChange={setFilters} disabled={disabled} loading={loading} error={error} />
          <SearchField label="Rechercher un client" value={search} onChange={setSearch} placeholder="Rechercher" disabled={disabled} loading={loading} error={error} />
        </div>
      </section>

      <section className={styles.section} id="display" aria-labelledby="display-title">
        <h2 id="display-title">Avatar, StatusPill et StatTile</h2>
        <div className={styles.examples}>
          <Avatar name={name || NAME} /><Avatar name={name || NAME} src="/design-image-inexistante.png" />
          <Avatar name={name || NAME} src={dataset === 'empty' ? undefined : '/icon.png'} />
          <StatusPill status="wait">En attente</StatusPill><StatusPill status="success">Signé</StatusPill>
          <StatusPill status="danger">En retard</StatusPill><StatusPill status="neutral">Brouillon</StatusPill>
        </div>
        <div className={styles.columns}>
          <StatTile label="Devis" value={dataset === 'empty' ? '0' : '5'} detail={description} />
          <StatTile label="À encaisser" value={dataset === 'empty' ? '0 €' : '8 420 €'} detail="Données d’exemple" />
        </div>
      </section>

      <section className={styles.section} id="overlays" aria-labelledby="overlays-title">
        <h2 id="overlays-title" ref={overlayHeadingRef} tabIndex={-1}>Sheet, AlertDialog et Menu</h2>
        <div className={styles.examples}>
          <Button variant="secondary" onClick={() => changeSheet(true)}>Ouvrir la feuille</Button>
          {archiveVisible && <Button variant="destructive" onClick={() => setAlert(true)}>Supprimer définitivement</Button>}
          <Menu title="Actions" trigger={<Button variant="secondary">Plus</Button>} items={menuItems} />
        </div>
        {!archiveVisible && <p role="status">Exemple supprimé définitivement.</p>}
      </section>

      <section className={styles.section} id="feedback" aria-labelledby="feedback-title">
        <h2 id="feedback-title">Hud, EmptyState, ErrorState et Skeleton</h2>
        <div className={styles.examples}>
          <Button variant="secondary" onClick={removeLine}>Supprimer la ligne</Button>
          <Button variant="secondary" onClick={() => setHud('error')}>Afficher un échec</Button>
        </div>
        <EmptyState headingLevel={3} title="Aucun client" description="Ajoutez votre premier client." actionLabel="Ajouter un client" actionLoading={loading} onAction={() => { setItemVisible(true); setLastAction('Ajouter un client'); }} />
        {listError ? <ErrorState headingLevel={3} title="Impossible de charger les documents" description="La connexion a été coupée. Vos documents n'ont pas bougé." retrying={loading} onRetry={() => setListError(false)} /> : <ListGroup headingLevel={3} title="Documents"><ListRow title="D-114" description={NAME} onClick={() => setLastAction('D-114')} disabled={disabled || loading} trailing={<Button variant="text" disabled={disabled || loading} onClick={() => setLastAction('Modifier')}>Modifier</Button>} /></ListGroup>}
        <Skeleton aria-label="Chargement des documents" />
      </section>

      <section className={styles.section} id="assistant" aria-labelledby="assistant-title">
        <h2 id="assistant-title">AssistantField</h2>
        <AssistantField value={assistant} onChange={setAssistant} onSubmit={() => { setLastAction(assistant); setAssistant(''); }} suggestions={SUGGESTIONS} placeholder="Décrivez les travaux" disabled={disabled} loading={loading} error={error} />
      </section>

      <section className={styles.section} id="signature" aria-labelledby="signature-title">
        <h2 id="signature-title">SignaturePad</h2>
        <SignaturePad value={signature} onChange={setSignature} />
        <output aria-live="polite">{signature ? 'Signature tracée' : 'Aucune signature'}</output>
        {signature && <a className="inline-flex min-h-11 items-center text-accent-texte underline" href={signature} download="signature-exemple.png">Télécharger la signature</a>}
      </section>

      <section className={styles.section} id="dock" aria-labelledby="dock-title">
        <h2 id="dock-title">Dock</h2>
        <Dock totalLabel="Total TTC" total={dataset === 'empty' ? '0 €' : '8 420 €'} actionLabel={actionLabel} onAction={() => setLastAction('Envoyer le devis')} disabled={disabled} loading={loading} />
      </section>

      <Sheet open={sheet} onOpenChange={changeSheet} onAfterClose={() => { if (removeAfterClose.current) finishRemoveLine(); }} title={dataset === 'long' ? 'Coordonnées du client Coordonnées du client' : 'Client'} onConfirm={() => { changeSheet(false); setLastAction('Enregistrer'); }} confirmLabel="Enregistrer" confirmLoading={loading} confirmDisabled={disabled}>
        <div className={styles.stack}>
          <Field type="text" label="Client" value={text} onChange={(event) => setText(event.currentTarget.value)} error={error} />
          <div className={styles.switchRow}>
            <label htmlFor={guardSwitchId}>Garder la feuille ouverte</label>
            <Switch id={guardSwitchId} label="Garder la feuille ouverte" checked={keepSheetOpen} onChange={setKeepSheetOpen} />
          </div>
          <Button variant="secondary" onClick={() => setNested(true)}>Ouvrir le deuxième niveau</Button>
          <Menu title="Actions du client" trigger={<Button variant="secondary">Plus</Button>} items={menuItems} />
        </div>
        <Sheet open={nested} onOpenChange={setNested} title="Adresse" onConfirm={() => setNested(false)}>
          <div className={styles.stack}>
            <Field type="text" label="Adresse" value={notes} onChange={(event) => setNotes(event.currentTarget.value)} />
            <Menu title="Actions de l’adresse" trigger={<Button variant="secondary">Plus au deuxième niveau</Button>} items={menuItems} />
            <Button variant="destructive" onClick={() => setAlert(true)}>Supprimer définitivement</Button>
          </div>
        </Sheet>
      </Sheet>
      <AlertDialog open={alert} onOpenChange={setAlert} title="Supprimer définitivement ?" description="Cette action est irréversible." confirmLabel="Supprimer" confirmLoading={loading} confirmDisabled={disabled} onConfirm={() => { alertNeedsFallbackFocus.current = !sheet; setArchiveVisible(false); setAlert(false); }} />
      {hud === 'error'
        ? <Hud open variant="error" onOpenChange={(open) => { if (!open) setHud(null); }} message="Envoi échoué" onRetry={() => { setHud(null); setLastAction('Réessayer'); }} />
        : <Hud open={hud === 'success'} onOpenChange={(open) => { if (!open) setHud(null); }} message="Ligne supprimée" onUndo={() => { setItemVisible(true); setHud(null); }} />}
    </main>
  );
}
