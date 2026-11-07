# Design system : Atelier by Orsayn

Ce document décrit ce qui existe dans le code, pas une intention. Les valeurs viennent de `src/app/globals.css`, `src/components/ui/`, `src/lib/motion.ts` et `src/lib/pdf/`. La maquette de référence (hors dépôt) est `design/maquettes/`.

Deux surfaces cohabitent, repérées par l’attribut `data-atelier-surface` posé sur `<html>` par `src/app/layout.tsx` :

- **`app`** : l’application des artisans et les pages vues par leurs clients. C’est l’objet de la refonte, décrite ci-dessous.
- **`cockpit`** : l’espace interne Orsayn (`/orsayn`). Il garde son langage propre, décrit en fin de document.

## 1. Principes

1. **Une chose principale par écran.** Le titre dit l’état (« 3 devis attendent »), pas le nom de la page.
2. **Un seul bouton plein par écran.** Les autres actions sont grises, en texte, ou rangées dans un menu.
3. **12 px entre un bouton plein et la note qui le suit.** Le rythme vertical est le même partout (voir §6).
4. **Créer ou modifier se fait dans une feuille** (`Sheet`) : elle monte du bas sur téléphone, s’ouvre au centre sur ordinateur. Deux niveaux de feuille au plus.
5. **Supprimer** : une action réversible se fait tout de suite, avec « Annuler » dans un `Hud` pendant quatre secondes. Une `AlertDialog` ne sert qu’à l’irréversible. Aucun `alert()` ni `confirm()` dans le code.
6. **Aucune fonction retirée.** L’essentiel est au premier plan, le reste derrière « Plus », dans le détail ou dans les réglages.
7. **Pas de décor.** Pas de 3D, pas de lueur, pas de dégradé. Une couleur sert l’état, l’action, une donnée.
8. **Peu de mots, des chiffres palpables, pas de jargon.** On n’écrit jamais le nom d’un fournisseur technique (OpenRouter, Stripe) dans l’interface d’un client.
9. **Une seule assistante : Sarah** (`AI_NAME` dans `src/lib/brand.ts`). Elle fait le devis, le chantier, le catalogue ; il n’y a pas d’autre personnage.

## 2. Thème et polices

- Thème : `next-themes`, stratégie par classe (`.dark` sur `<html>`), préférence système par défaut, clé de stockage `theme`. Un script inline (avec le nonce de la CSP) évite le flash au chargement.
- **Inter** (local, 400/500/600/700) : texte de l’application, variable `--font-inter`.
- **Geist** (local, variable) : titres et chiffres, variable `--font-geist`.
- **General Sans** : vues du cockpit seulement.
- Les nombres utilisent `font-variant-numeric: tabular-nums`.

## 3. Jetons (`--at-*`)

Ils sont définis sous `html[data-atelier-surface="app"]` (clair) et `html[data-atelier-surface="app"].dark` (sombre). Chaque couleur existe aussi en `-rgb` pour composer une opacité. Dans un module CSS, on écrit `var(--at-encre)`, jamais une valeur.

### Couleurs

| Jeton | Rôle | Clair | Sombre |
| --- | --- | --- | --- |
| `--at-fond` | fond de page | 242 242 247 | 0 0 0 |
| `--at-carte` | surface d’un groupe, d’une feuille | 253 253 254 | 27 27 27 |
| `--at-carte-2` | surface en retrait | 242 242 247 | 44 44 44 |
| `--at-encre` | texte principal | 26 26 26 | 242 242 247 |
| `--at-encre-2` | texte secondaire | 110 110 111 | 177 177 181 |
| `--at-encre-3` | texte discret, désactivé | 146 146 146 | 103 103 105 |
| `--at-trait` | filet de 0,5 px | 216 216 217 | 74 74 76 |
| `--at-remplissage` | fond de puce, de segment | 230 230 231 | 61 61 62 |
| `--at-accent` | aplat d’action (orange Atelier) | 255 159 28 | 255 159 28 |
| `--at-sur-accent` | texte posé sur l’accent | 13 13 13 | 13 13 13 |
| `--at-accent-texte` | accent utilisable en texte | 176 93 0 | 255 179 71 |
| `--at-hausse` / `--at-baisse` | hausse, baisse | 52 199 89 / 255 59 48 | 48 209 88 / 255 69 58 |
| `--at-danger-texte` | texte d’erreur, de suppression | mélange baisse + encre | idem |
| `--at-alerte`, `--at-alerte-texte` | avertissement | accent | accent |
| `--at-s1` … `--at-s5` | séries de graphiques | accent, bleu, vert, violet, gris | idem |

L’orange `#FF9F1C` ne tient pas en texte sur fond clair (environ 1,9:1). Il sert d’aplat avec un texte `--at-sur-accent`. Pour écrire en orange, on prend `--at-accent-texte`.

### Espaces, rayons, texte

- Espaces : `--at-espace-2, 4, 8, 12, 16, 20, 24, 32, 48`.
- Rayons : `--at-rayon-champ` 10, `--at-rayon-bouton-arrondi` 12, `--at-rayon-groupe-liste` 20, `--at-rayon-carte` 24, `--at-rayon-feuille` 26, `--at-rayon-menu` 16, `--at-rayon-alerte` 18, `--at-rayon-pilule` 999.
- Texte : titre large 34, titre 1 28, titre 2 22, titre 3 20, ligne 17, corps 17, accroche 16, sous-titre 15, note 13, légendes 12 et 11, chiffre vedette 44, prix 40. Chaque taille a son interligne, son approche et son poids (`--at-interligne-*`, `--at-approche-*`, `--at-poids-*`).

Tailwind expose ces jetons dans `@theme inline` : `bg-fond`, `bg-carte`, `text-encre`, `text-encre-2`, `border-trait`, `bg-remplissage`, `text-accent-texte`, `p-espace-16`, `text-titre-1`… Les écrans migrés préfèrent un module CSS.

### Mouvement (`src/lib/motion.ts`)

Neuf rôles, un par intention : `appui` (0,1 s, échelle 0,97), `couleur` (0,32 s), `apparition` (0,24 s, 8 points au plus), `deplacement` (0,3 s), `entree` (ressort doux), `sortie` (0,2 s, plus courte que l’entrée), `pose` (ressort vif), `reussite` et `suivi`. Cinq ressorts : `doux`, `vif`, `rebondi`, `interactif`, `lent`. Le mouvement réduit est respecté : les durées tombent à 0,01–0,12 s.

## 4. Composants (`src/components/ui/`)

| Composant | Rôle |
| --- | --- |
| `Button` | `variant` primary, secondary, text, destructive ; `size` sm, md, lg ; `loading`, `loadingText` |
| `Field` | champ à libellé permanent : `type` text, email, tel, date, time, number, select, textarea ; `inputType`, `hint`, `error`, `loading` ; accepte les attributs natifs (`name`, `list`, `autoComplete`…) |
| `NumericInput`, `UnitSelect` | saisie numérique et unité (devis, catalogue) |
| `ListGroup`, `ListRow`, `CheckRow` | liste groupée à l’iOS : titre, description, pied ; ligne cliquable (lien ou bouton) avec contenu en tête et en queue |
| `SegmentedControl`, `FilterChips` | choix exclusif, filtres |
| `SearchField` | recherche contrôlée avec effacement |
| `Switch` | interrupteur, appliqué tout de suite |
| `Sheet` | feuille accessible : focus piégé, Échap, retour du focus, glisser pour fermer ; Annuler à gauche, action à droite |
| `AlertDialog` | confirmation d’une action irréversible |
| `Menu` | menu « Plus » (⋯) |
| `Hud` | retour d’action avec « Annuler » ou « Réessayer » |
| `StatusPill` | pastille d’état : wait, success, danger, neutral |
| `StatTile` | chiffre clé |
| `EmptyState`, `ErrorState`, `Skeleton`, `PageSkeleton` | états vide, erreur, chargement |
| `Avatar` | initiales ou image |
| `Dock` | barre de total et d’action fixe en bas d’un éditeur |
| `SignaturePad` | signature manuscrite |
| `AssistantField` | champ de demande à l’assistante |
| `icons/AtelierIcons` | famille d’icônes maison (trait de 1,6 à 1,75) ; Lucide pour les icônes utilitaires |

La page `/design` (développement seulement) montre chaque composant dans tous ses états. Elle sert de preuve pour les portes qualité.

### Pièces par famille d’écran

- **Navigation** (`components/layout/`) : `Sidebar` (ordinateur), `TabBar` (téléphone, cinq lieux), `NavigationCommands` (recherche ⌘K, « + » global, cloche), `RouteShortcuts`. Les droits et les modules masquent ce qu’ils masquent (`NavigationAccess`).
- **Connexion et démarrage** (`components/auth/`) : `AuthLayout`, `AuthParts` (champs, erreurs, mot de passe, code à six chiffres), `useHydrated` (un bouton grisé par la saisie n’utilise `aria-disabled` qu’après hydratation, pour que les formulaires fonctionnent sans JavaScript).
- **Erreurs** (`components/errors/`) : `ErrorPage` (404, erreur, hors ligne, lien expiré, accès réservé), `ErrorActions`. Elle retombe sur des couleurs système pour fonctionner jusque dans `global-error.tsx`.
- **Assistante** (`components/sarah/`) : une feuille (`SarahSheet`) sur le moteur historique.
- **Panneaux de devis** (`components/quotes/`, `components/ai/`, `components/catalog/`) : feuilles et groupes de liste.

## 5. Structure d’un écran migré

Le `page.tsx` serveur et les server actions ne bougent pas. Le reste suit toujours la même coupe :

```
page.tsx            serveur : lecture des données, droits
XxxClient.tsx       assemblage de l'écran
useXxx.ts           état et actions (hook)
xxxModel.ts         calculs et règles pures, testés dans src/__tests__/
XxxSheets.tsx       feuilles de création et de modification
Xxx.module.css      styles, uniquement avec les jetons --at-*
```

Un fichier migré porte `// @atelier-migrated` (ou `/* @atelier-migrated */` en CSS). Ce marqueur active la règle ESLint `atelier/no-hardcoded-colors` (`eslint/rules/no-hardcoded-colors.mjs`), qui refuse toute couleur hexadécimale ou nommée (`orange`, `red`…). Sont acceptés les mots-clés système `Canvas`, `CanvasText`, `AccentColor`, `GrayText`, `LinkText`, utiles quand les jetons peuvent manquer (pages d’erreur globales, chargement partagé avec le cockpit).

Exceptions assumées, car ce sont des données et non du style : les couleurs d’équipe choisies par l’utilisateur (`EQUIPE_COLORS`, `equipesModel.ts`), les exemples de configuration client, l’intégration Leaflet.

## 6. Rythme et espacement

- Entre deux groupes d’une feuille : 20 px (`.detail` de `QuoteEditor.module.css`, partagé par les feuilles).
- Entre un bouton plein et la note qui le suit : 12 px (`.heroNote`, `.planFoot`…).
- Dans une liste : 44 px de hauteur de ligne au moins, 16 px de marge intérieure, filet de 0,5 px.
- Cibles tactiles : 44 px.

## 7. Qualité

- `npm run check` : typecheck, lint (règle des couleurs comprise), 897 tests.
- `npm run test:e2e` (Playwright, Supabase local) : navigation par rôle, six parcours quotidiens, facturation électronique, transport de l’authentification sans JavaScript.
- `scripts/render-pdf-samples.mts` : rend les dix PDF sur des jeux d’exemple (`.scratch/pdf/`).
- Mesure d’épure par écran : boutons pleins (1), onglets (5 au plus), couleurs codées en dur (0).

## 8. PDF (`src/lib/pdf/`)

Dix documents sur un socle commun : devis, facture, contrat, DGD, rapport de chantier, rapport mensuel, rapport de pilotage, rapport d’intervention, rapport d’heures, feuille de route.

- Polices : Inter (texte), Geist Bold et Geist Medium (titres), générées depuis la police variable du dépôt.
- `engine/kit.ts` : blocs partagés (en-tête réduit au logo, en-tête compact en page 2 et suivantes, métadonnées, parties, tableau à filets fins, totaux, notes, signature, pied de page centré avec pagination). L’échelle est celle de la maquette : 1 px = 0,75 pt.
- `engine/legal.ts` : pied de page légal, parties, garantie décennale.
- Une page quand le contenu tient. « Devis » et « Facture » sont petits et non gras.
- Intouchés : les invariants Factur-X (`facturx-*.ts`) et les mentions légales BTP (`btp-legal-mentions.ts`).

## 9. Cockpit Orsayn : règles prioritaires

Cette section s’applique au cockpit Orsayn et à tout nouvel asset visuel Orsayn. Elle prime sur les conventions génériques lorsqu’elles entrent en conflit.

- Pas de bande, bordure ou rail vertical coloré posé sur le côté d’une card ou d’un bento pour décorer. En particulier, pas de barre bleue, violette, ambre ou dégradée utilisée comme signal visuel générique : c’est du décor automatique sans information.
- Pas de gradients, halos, glow, glassmorphism ou ombres 3D ajoutés par défaut pour donner une impression « IA ». Une couleur ne sert que l’état, le focus, l’action ou une donnée réelle.
- Les surfaces restent sobres : blanc dominant, parchemin `#f4f3ec`, encre `#0d0d0d`, hairlines neutres de 1 px et bleu `#000ce1` utilisé avec parcimonie.
- Les cards gardent des rayons compacts (4–8 px), des espacements généreux et une hiérarchie lisible. Un séparateur neutre peut structurer une grille, mais ne doit pas devenir un accent décoratif.
- Le cockpit est clair uniquement. Le thème sombre global ne doit pas modifier ses surfaces, ses graphiques, sa navigation ou ses contrôles.

Toute nouvelle card, bento, illustration ou asset doit être relu avec cette question : « quelle information ce traitement apporte-t-il ? » Si la réponse est aucune, le traitement est à supprimer.

Le cockpit garde l’ancienne couche de jetons (`--bg-base`, `--text-primary`, `--accent-primary`, `--cockpit-*`, classes `.card`, `.input`, `.btn-pill`, `.cockpit-*`) dans `globals.css` et `tailwind.config.ts`. Aucun écran de la surface `app` ne l’utilise.

## 10. Fichiers de référence

- `src/app/globals.css` : jetons, thème, couche cockpit.
- `src/components/ui/` : composants (un module CSS par composant).
- `src/lib/motion.ts` : rôles de mouvement.
- `src/lib/brand.ts` : nom de l’assistante, logos.
- `eslint/rules/no-hardcoded-colors.mjs` : règle des couleurs.
- `docs/design/fondations.md`, `docs/design/qualification.md` : décisions de fondations et dossier de qualification.
- `docs/design/recherche-ux.md` : sources et motifs retenus.
