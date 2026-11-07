# Guide de reprise pour les agents : design Apple d'Atelier

Ce document est le point d'entrée de tout agent qui reprend le travail de design d'Atelier by Orsayn (écrans, composants, PDF, puis landing page). Il dit **dans quel esprit** travailler, **quelles règles** ne jamais enfreindre, **comment** s'y prendre, et **où en est** le chantier. Il ne remplace pas `docs/design-system.md` (les jetons, les composants, les valeurs exactes) : il le complète par la vision et la méthode.

Mis à jour le 7 novembre 2026, à la fin de la phase 6 (nettoyage et review globale).

## 1. Ordre de lecture

1. Ce guide (15 minutes).
2. `docs/design-system.md` : ce qui existe réellement dans le code (jetons `--at-*`, composants `src/components/ui/`, structure d'un écran, rythme, PDF).
3. `docs/design/recherche-ux.md` : les sources externes (HIG, NN/g, Linear, Stripe, concurrents BTP) et les motifs retenus. Les sources n'ont pas été relues ligne à ligne : les vérifier avant de les citer à l'extérieur.
4. `docs/design/qualification.md` : les parcours réels prouvés par les tests.
5. Hors dépôt, sur le disque du propriétaire : `Atelier-code/kompagnon-project/design/` avec `PLAN-IMPLEMENTATION.md` (les phases et leur critère « Fini quand »), `PROMPT-EXECUTANT.md` (le prompt de l'exécutant), `maquettes/` (la maquette HTML cliquable, `PARCOURS.md` = la liste des fonctions de chaque écran). **Ne jamais committer ce dossier.** Pour le lire : `cd design/maquettes && python3 -m http.server 8770`, puis `http://localhost:8770/index.html`.
6. Le skill `atelier-ux-patterns` (`ID VISUELLE/design-system/atelier-ux-patterns/SKILL.md`) pour les règles d'or et la checklist d'audit.

Si deux sources se contredisent, le code et la maquette l'emportent sur la prose. Si une source manque, s'arrêter et le signaler plutôt que deviner.

## 2. La vision, en une page

Atelier est utilisé par des artisans du bâtiment, souvent sur un chantier, sur téléphone, avec peu de temps et peu d'attention. L'idée « à la Apple » n'est pas une esthétique à copier : c'est une discipline.

- **Un écran dit une chose.** Le titre énonce l'état (« 3 devis attendent »), pas le nom de la page.
- **Une seule action pleine par écran.** Tout le reste est gris, en texte, ou rangé derrière « Plus » (⋯). Trois à cinq boutons empilés en haut d'un écran mobile sont le premier signe de surcharge.
- **Rien n'est supprimé.** L'essentiel est devant, le reste est derrière « Plus », dans le détail ou dans une feuille. Une fonction qui disparaît est un bug.
- **Du calme.** Pas de relief, pas de lueur, pas de dégradé, pas de 3D. Une couleur sert l'état, l'action ou une donnée.
- **Peu de mots, des chiffres palpables.** Les gens scannent. Jamais de jargon, jamais le nom d'un fournisseur technique (OpenRouter, Stripe) dans l'interface d'un client.
- **Une seule assistante : Sarah** (`AI_NAME`, `src/lib/brand.ts`). Avant d'agir vers l'extérieur (envoi, relance, création), elle montre ce qu'elle va faire.
- **Tout état existe** : vide (avec une action), chargement (squelette), erreur (avec « Réessayer »), réussite, accès réservé.
- **Téléphone et ordinateur à égalité.** Un écran n'est pas fini s'il n'est pas beau à 390 px et à 1280 px, en clair et en sombre.

## 3. Règles non négociables

Décisions déjà prises, à appliquer sans les rediscuter :

- Une seule assistante, « Sarah », partout. Pas de passage de relais entre personnages.
- La réception du chantier est dans « Travaux », en bloc « Fin de chantier et réception ».
- Titres des PDF en Geist Bold (corps en Inter).
- L'icône d'une ligne de liste ne pose jamais sur un rond ou un carré coloré (sauf les tuiles du menu Entreprise et des Réglages).
- Un seul bouton plein par écran. Dans une feuille : Annuler à gauche, l'action à droite, grisée tant que la saisie est invalide.
- Créer ou modifier = `Sheet`. Supprimer du réversible = effet immédiat + `Hud` avec « Annuler » (4 secondes). `AlertDialog` seulement pour l'irréversible. Aucun `alert()` ni `confirm()`.
- Deux niveaux de feuille au plus.
- **12 px** entre un bouton plein et la note qui le suit, **20 px** entre deux groupes d'une feuille. Même rythme vertical sur tous les écrans.
- Aucun texte coupé, aucun bouton sur deux lignes, aucun débordement. De l'air sur téléphone.
- Cibles de 44 px, contraste vérifié, mouvement réduit respecté.
- Vouvoiement ; boutons à verbe (« Envoyer le devis ») ; pas de « Oups », pas de point d'exclamation, pas de tiret cadratin ; espaces insécables avant `: ; ? ! %` et `€`.
- **Le serveur ne bouge pas** : pas de changement aux `page.tsx` serveur, `src/lib/data/**`, `src/app/api/**`, `supabase/`, ni aux permissions et modules. Exception : une fonction explicitement nommée par le plan, dans une PR à part avec son test (déjà faits : quota de Sarah, nouveau lien de signature).
- **Le cockpit `/orsayn` est intouchable** : ses fichiers, ses jetons `--cockpit-*`, ses anciennes classes (`.card`, `.input`, `.btn-pill`, `.cockpit-*`, `--bg-base`…), General Sans, son thème clair.
- Les droits et modules restent : chaque bloc garde sa clé de permission et son module ; le vocabulaire suit le profil d'activité (`btp`, `industry`, `cleaning`).

## 4. Patterns : quel composant pour quel besoin

| Besoin | Composant (`src/components/ui/`) |
|---|---|
| Action principale | `Button` `primary` (une seule par écran) ; `secondary`, `text`, `destructive` sinon |
| Liste d'éléments | `ListGroup` + `ListRow` (préférer à un tableau), `CheckRow` pour les cases |
| Créer, modifier | `Sheet` (`onCancel`, `onConfirm`, `confirmDisabled`, `confirmLoading`) |
| Confirmer l'irréversible | `AlertDialog` |
| Retour d'action, annulation | `Hud` (`onUndo`, `onRetry`) |
| Champ de saisie | `Field` (`text`, `email`, `tel`, `date`, `time`, `number`, `select`, `textarea`) |
| Choisir une vue | `SegmentedControl` (4 segments au plus sur téléphone) |
| Recherche | `SearchField` |
| État d'un document | `StatusPill` (`wait`, `success`, `danger`, `neutral`) |
| Chiffre clé | `StatTile` (3 au plus à l'accueil) |
| Actions secondaires | `Menu` (⋯) |
| Liste vide / erreur | `EmptyState` (avec une action), `ErrorState` ou `ErrorPage` (pages) |
| Chargement | `Skeleton`, `PageSkeleton` |
| Total fixe + action | `Dock` |
| Signature | `SignaturePad` |
| Interrupteur | `Switch` (s'applique tout de suite, sans « Enregistrer ») |

Si un composant manque, **ne pas le bricoler dans l'écran** : le signaler, il fait l'objet d'une PR de composant avec son test.

Structure d'un écran migré (détail dans `docs/design-system.md` §5) :

```
page.tsx          serveur, inchangé
XxxClient.tsx     assemblage
useXxx.ts         état et actions
xxxModel.ts       règles pures, testées dans src/__tests__/
XxxSheets.tsx     feuilles
Xxx.module.css    styles avec les jetons --at-* uniquement
```

Le marqueur `// @atelier-migrated` (ou `/* @atelier-migrated */` en CSS) active la règle ESLint `atelier/no-hardcoded-colors` : aucune couleur hexadécimale ni nommée. Mots-clés système tolérés : `Canvas`, `CanvasText`, `AccentColor`, `GrayText`, `LinkText`. Pour le texte orange : `--at-accent-texte` (l'orange `--at-accent` sert en aplat avec un texte `--at-sur-accent`). `--at-danger-texte` est une couleur de texte, jamais un fond.

## 5. Méthode pour migrer ou créer un écran

1. Lire la maquette, `PARCOURS.md` et les fichiers réels de l'écran **en entier**.
2. Mesurer l'avant : boutons pleins, onglets, couleurs en dur, nombre d'appuis pour l'action principale.
3. Sortir la logique : tests sur la logique actuelle d'abord, puis extraction en hook / modèle, puis nouvel affichage. Un fichier de plus de 2 000 lignes se découpe en plusieurs PR.
4. Construire avec les composants `ui/` et les jetons seulement.
5. Vérifier : `npm run check` ; E2E des parcours touchés ; captures à 360, 390, 768 et 1280 px, en clair et en sombre, avec de vraies données, aucune donnée, et des textes deux fois plus longs ; aucun débordement ; clavier ; mouvement réduit ; liste des fonctions de `PARCOURS.md` cochée.
6. Ouvrir une PR en brouillon, avec : ce qui a changé, la liste des fonctions, les mesures avant/après, **ce qui est vérifié et ce qui ne l'est pas** (voir §9).

## 6. Carte du dépôt

- `src/app/globals.css` : jetons `--at-*` (surface `app`, + `.dark`) et couche héritée du cockpit.
- `src/components/ui/` : la bibliothèque. `src/lib/motion.ts` : rôles de mouvement.
- `src/components/errors/` : `ErrorPage`, `ErrorActions`, `AccessDenied` ; `src/components/layout/` : `AppShell`, `Sidebar`/`TabBar`, `OfflineBanner`.
- `src/lib/pdf/` : moteur des dix PDF (pdf-lib + fontkit, `engine/kit.ts`, `engine/legal.ts`) ; `scripts/render-pdf-samples.mts` les rend sur des jeux d'exemple. Les invariants Factur-X ne se touchent pas.
- `src/app/(app)/…` : écrans de l'app ; `src/app/(auth)` : connexion et inscription ; pages publiques (signature, espace intervenant, demande de devis, légal) migrées avec la surface `app`.
- `eslint/rules/no-hardcoded-colors.mjs` : la règle des couleurs.
- `e2e/` : parcours Playwright ; `scripts/e2e-qualification-server.mjs` : serveur de qualification (Supabase local migré).
- `.github/workflows/` : CI et déploiements (voir §10).

## 7. Commandes

Node 24 obligatoire (`export PATH=/opt/homebrew/opt/node@24/bin:$PATH`), `NODE_OPTIONS=--max-old-space-size=6000` pour le build.

```bash
npm run check                                   # types + lint (couleurs comprises) + Vitest
node ./scripts/e2e-qualification-server.mjs --build   # build de production pour l'E2E
E2E_NEXT_SERVER_MODE=start node ./scripts/e2e-qualification-server.mjs   # serveur sur le port 3456
E2E_NEXT_SERVER_MODE=start npx playwright test e2e/navigation.spec.ts e2e/daily-workflows.spec.ts e2e/einvoicing-settings.spec.ts e2e/auth-transport.spec.ts --reporter=line
npx tsx scripts/render-pdf-samples.mts          # les dix PDF d'exemple dans .scratch/pdf/
```

Avant un commit : `git checkout next-env.d.ts` (le build le modifie). Ne tuer que des PID explicites.

## 8. Pièges déjà rencontrés

- **Ne pas viser les classes CSS héritées dans les tests E2E** (`.card`) : utiliser les rôles ARIA (`dialog`, `button`).
- **Machine chargée = E2E qui expirent** à `page.goto` : relancer machine libre avant de conclure à un bug.
- **Élaguer du CSS par expression régulière casse les groupes de sélecteurs** : utiliser PostCSS, au niveau du sélecteur.
- **Un script d'import qui ne voit pas les imports nommés** (`import { X } from …`) casse silencieusement un composant : relancer typecheck après toute suppression de fichier.
- **Un jeton de texte n'est pas un fond** : « Bloquant » sur fond `--at-danger-texte` était illisible.
- **Une pastille doit garder sa place** dans une ligne de liste (`.trailing` : `min-width: min-content; max-width: 45%`), sinon elle recouvre le texte.
- **Les maquettes ne sont pas dans le dépôt.** Ne pas les committer ; ne pas supposer qu'un autre poste les a.
- **Un test de PDF sans `issuance_snapshot`** reçoit 409 par conception (facture et rapport mensuel) : émettre la facture par l'app, ne pas contourner.
- **Le dépôt est public et son historique a été réécrit** : jamais de `.env`, de `design/`, d'`artifacts/` ni de stratégie commerciale dans un commit.

## 9. État au 7 novembre 2026

Fait et vérifié (894 tests Vitest, 20 parcours E2E sur 20, 108 pages sans débordement à 390 et 1280 px en clair et sombre, Factur-X valide EN 16931 par schéma et schematron) :

- Phases 1 à 3 : fondations, 23 composants, navigation (TabBar à cinq lieux, barre latérale).
- Phase 4 : Aujourd'hui, Documents, éditeur de devis et de facture, Récurrentes, Contrats, Clients, Demandes, Sarah, Chantiers (fiche en quatre segments), Planning, Entretien, Heures, Équipes, Catalogue, Modèles, Réglages (liste groupée), Rapports, connexion et onboarding, pages d'erreur, pages publiques.
- Phase 5 : les dix PDF.
- Phase 6 : nettoyage (code mort, 76 règles CSS héritées), documentation, accès réservé, session expirée, bandeau hors ligne.

Hors périmètre ou conservé volontairement : le cockpit `/orsayn` (et ses jetons et classes), `Topbar` / branche Sarah héritée / `BottomNav` (cockpit seulement), `AssistantField` (conservé, non utilisé), `ErrorState` (conservé).

À faire : **la landing page** (dépôt `atelierbyorsayn`, plan séparé). Elle reprend les jetons `--at-*` et les composants ; les boutons 3D et le double liseré sont abandonnés au profit du style plat.

## 10. Mise en production (à lire avant tout push sur `main`)

- `main` est protégé par l'habitude, pas par un verrou : le prompt de l'exécutant interdit de pousser dessus. Le passage de la refonte sur `main` est une décision explicite du propriétaire.
- **Un push sur `main` déclenche la CI, puis le déploiement automatique de `atelier-app`** (`.github/workflows/deploy-atelier-app.yml`, environnement GitHub « Atelier CDF »). `atelier-app` est l'instance mutualisée (`app.atelier-btp.fr`, projet Supabase `pyxnmohknxmbpbcuvudg`) : abonnés Pro/Expert et clients setup à 3 000 € y vivent dans des organisations isolées. **Tout changement de `main` atteint donc de vrais clients.**
- Les instances dédiées historiques ne se déploient que sur demande (`deploy-client.yml`, `deploy-all-clients.yml`, liste dans `scripts/clients.txt`).
- Une migration `supabase/migrations/216_signature_link_requests.sql` accompagne la refonte (table de demandes de nouveau lien de signature). Elle doit être appliquée à la base de production **avant** le déploiement, sinon cette fonction échoue (le reste de l'app n'en dépend pas).
- La CI contrôle types, lint, tests, audit des dépendances de production, scan de secrets sur tout l'historique et SBOM ; les E2E ne font pas partie de la CI.
- Procédure détaillée du déploiement mutualisé : `DEPLOIEMENT_CLIENT.md`.

## 11. Ce qui n'est pas vérifié

Classé par ce qu'il faut pour le vérifier. Mettre à jour cette liste à chaque vérification.

**A. Réalisable en local (base locale + boîte mail de test) :**
- Réglages : enregistrement réel de toutes les valeurs « Entreprise » (seule la ville l'a été) ; FEC téléchargé avec succès ; génération réelle d'une sauvegarde ; retrait effectif d'un membre ; invitation d'équipe (réglages et onboarding) et soumission de `/invite/setup` ; liens catalogue / fournisseur d'une grille de matières.
- Relances : envoi par le cron ; rendu du formulaire public côté prospect.
- Rapports : bloc Entretien (pas de contrat sur le compte d'essai), heures par personne (aucune heure), valeurs sur plusieurs mois ; contenu du PDF de rapport.
- PDF d'une vraie facture et du rapport mensuel (émettre la facture par l'app pour obtenir son `issuance_snapshot`).
- Entretien : upload de photo et envoi du rapport.
- Feuilles ouvertes à 390 px (seules celles à 1280 px ont été capturées) ; Argent / Équipe / Photos en sombre.
- Nouveau lien intervenant : envoi réel.

**B. Demande un compte ou une clé externe :**
- Stripe : portail, résiliation, paiement et régularisation d'un setup, état « achat setup suspendu » (pas de clés d'essai).
- Super PDP : connexion.
- Assistante Sarah : appels IA et enregistrement d'une clé OpenRouter client (le compte d'essai n'est pas en « clé du client »).
- Envoi réel d'emails (Resend) ; bouton flottant sur un site tiers.
- PDF/A strict : veraPDF (nécessite Java), non installé.
- Fermeture réelle d'un compte (non lancée volontairement).

**Vérifié pendant la review globale :** Factur-X (schéma + schematron), logo et photos réels, devis de dix pages, PDF de données réelles (devis, chantier, DGD, rapport annuel), inscription avec un vrai code reçu par email, rendu de `global-error` et de l'accès réservé.

## 12. Avant d'ouvrir une PR (checklist)

- [ ] `npm run check` passe ; E2E des parcours touchés passent.
- [ ] Zéro couleur en dur dans les fichiers touchés ; un seul bouton plein par écran ; aucun `alert()` / `confirm()`.
- [ ] Captures 360 / 390 / 768 / 1280, clair et sombre, trois jeux de données ; aucun débordement.
- [ ] Clavier et mouvement réduit.
- [ ] Toutes les fonctions de l'écran sont encore là (liste de `PARCOURS.md`).
- [ ] Le corps de la PR dit ce qui est vérifié **et** ce qui ne l'est pas.
- [ ] Rien de `design/`, `artifacts/`, `.env` dans le commit.
