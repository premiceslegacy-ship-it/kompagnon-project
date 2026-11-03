# Fondations de la refonte Atelier

Ce lot prépare les composants et les écrans. Il ne constitue pas leur refonte complète. Les phases suivantes restent soumises à la validation du propriétaire.

## Rôles et compatibilité

`src/app/globals.css` déclare les rôles `--at-*` de la maquette et leurs variantes sombres. Les utilitaires sémantiques sont exposés par `@theme inline`. Les valeurs exactes et les échelles sont centralisées dans cette feuille, pas recopiées dans les composants.

Les durées utilisent le namespace `--transition-duration-*`, réellement reconnu par Tailwind 4 pour générer `duration-appui`, `duration-couleur` et les autres rôles. Les classes `text-prix` et `text-chiffre-vedette` reçoivent explicitement leur famille côté app : Tailwind ne traduit pas la métadonnée `--text-*--font-family`. La compilation ciblée des sept durées, des deux échelles numériques, de l’espace, du rayon et de la courbe a été exercée avec le compilateur installé.

Les anciens jetons restent des alias pendant la migration des écrans. Les formats RGB historiques sont préservés pour les utilitaires qui appliquent une opacité. Les jetons sans équivalent univoque restent inchangés plutôt que d’être réinterprétés. Cette couche temporaire doit disparaître à la phase de nettoyage prévue dans le plan.

Les aliases legacy `success` et `danger` conservent leurs anciennes valeurs : les relier directement à hausse/baisse diminuait le contraste de certains textes de statut existants. Les nouveaux rôles restent conformes à la maquette ; leurs composants distingueront le fond sémantique du texte de statut lors de la migration. Cela préserve le contraste hérité, sans prétendre corriger son défaut AA déjà présent.

Les nouveaux rôles de l’app sont limités à `html[data-atelier-surface="app"]`. Ils ne doivent pas redéfinir les variables `--cockpit-*` ni reprendre l’apparence du cockpit.

## Polices et thème

- Inter local, poids 400/500/600/700 : texte de l’app.
- Geist variable local, instance unique : titres et rôle numérique.
- General Sans : vues du cockpit, dont l’identité reste indépendante.
- Le rôle historique Jakarta est une compatibilité temporaire, pas un chargement supplémentaire de police.

Les fontes Inter 400/700 de référence remplacent les anciens binaires non référencés sous les chemins canoniques `inter-latin-400.woff2` et `inter-latin-700.woff2`. Aucun second jeu `inter-refonte-*` n’est conservé. La licence Inter accompagne les fichiers dans `public/fonts`.

Les classes de variables `next/font` sont déclarées sur `<html>`, pas sur `<body>` : les alias et rôles définis à la racine doivent pouvoir les résoudre. Les titres et les classes numériques legacy conservent Geist pendant cette phase. La variable Inter de l’app n’est pas activée en mode cockpit ; son ancien alias y continue de résoudre Geist pour ne pas modifier la typographie héritée.

`src/components/theme-provider.tsx` utilise `next-themes`, la classe du document, la préférence système par défaut et la clé de stockage historique `theme`. L’API `useTheme` existante conserve `theme` et `setTheme`. Le cockpit reste clair ; la valeur exposée par le hook tient compte du thème forcé.

Le layout racine transmet le nonce `x-nonce` déjà créé par le middleware au script de thème. La CSP n’est pas assouplie pour autoriser ce script. La lecture du nonce avec `headers()` rend le layout dynamique : c’est un choix explicite de sécurité et de rendu par requête, à prendre en compte pour les pages publiques qui héritent de ce layout.

## Mouvement et garde de couleurs

`src/lib/motion.ts` fournit la grammaire commune de mouvement et le traitement du mouvement réduit. Les futurs composants doivent réutiliser ces rôles plutôt qu’introduire une seconde convention d’animation.

Le changement de thème de l’app utilise le rôle couleur : 320 ms normalement, 120 ms en mouvement réduit. Les rôles CSS de couleur et de sortie suivent ce budget réduit plutôt que de conserver leur durée normale. La classe de durée historique du cockpit reste inchangée.

Le scénario de phase 1 `e2e/theme-preferences.spec.ts` active `prefers-reduced-motion`, se connecte réellement, relève les couleurs calculées du corps avant et après la bascule et observe les durées des transitions rendues. Une bascule instantanée est valide ; un changement de classe sans changement visuel ne l’est pas. La première version du test pouvait passer sans observer de transition et ne suffisait pas à conclure sur la référence. Le test renforcé reproduit aussi 300 ms sur l’app d’origine : le défaut est hérité, pas exclusivement introduit par la refonte. Le rôle couleur réduit du candidat le corrige à 120 ms, observés aussi en fumée manuelle. Le clavier, le focus visible et la persistance après rechargement sont contrôlés séparément.

La règle `atelier/no-hardcoded-colors` protège automatiquement `src/components/ui/**`, ainsi que les autres fichiers portant le commentaire `@atelier-migrated`. Elle couvre les classes de palette, les couleurs littérales de style et les attributs SVG, y compris les constantes locales partagées. Le processeur ESLint `atelier/css` analyse aussi les déclarations des modules CSS concernés : couleurs hexadécimales, fonctions littérales, couleurs nommées et valeurs de repli. Les références SVG `url(#…)`, commentaires, chaînes CSS et expressions fondées sur `var(--…)` ne sont pas confondus avec des couleurs littérales.

Ce contrôle n’est pas une preuve d’analyse exhaustive des valeurs importées, calculées dynamiquement ou des identifiants CSS échappés. La lecture du code et la vérification visuelle restent nécessaires. Les écrans legacy ne sont pas déclarés migrés simplement parce qu’ils héritent des nouveaux alias.

## Arbitrages de référence

Lorsque le JSON de tokens et le CSS rendu des maquettes divergent, le rendu CSS validé fait foi :

- rayon de carte : 24 px ;
- accent texte clair : `#b05d00` ;
- troisième couleur sémantique claire : `#2fa84e`.

Le breakpoint spécifique `atelier` vaut 900 px. Les dimensions particulières de grand affichage restent distinctes de l’échelle d’espacement générale.

La hiérarchie des actions sera traitée à la migration des écrans : un seul bouton plein par défaut, avec arbitrage final d’Opus sur les cas ambigus. Cet arbitrage ne supprime aucune fonction existante.

## Limites du lot

Les Server Actions, les APIs, les migrations, les calculs, les permissions et les invariants Factur-X/BTP ne sont pas modifiés. Les composants, la navigation et les écrans seront migrés dans l’ordre du plan, sans présenter les anciens écrans comme déjà conformes aux maquettes.

Le petit correctif de transport des formulaires de connexion et d’inscription est indépendant de leur futur redesign. Son périmètre et sa régression navigateur sont décrits dans [qualification.md](./qualification.md).

La qualification du lot doit inclure le cockpit réellement rendu, les variantes de thème et le premier affichage sombre ; une lecture des variables CSS ne suffit pas. Voir [le protocole de qualification](./qualification.md).

## Qualification locale exercée

- Le build de production local de référence et celui du candidat ont été exécutés avec des bases Supabase locales migrées, sans `.env` de client.
- Les six parcours métier passent sur la référence. Le candidat corrigé passe dix scénarios ensemble : ces six parcours, les deux transports natifs de formulaire, l’accès autorisé aux réglages de facturation électronique et le mouvement réduit du thème.
- La comparaison de l’app contient 57 cas, chacun capturé à 360/390/768/1280 px en clair et sombre, avant et après : 912 captures stables. Elles couvrent des routes et états réellement atteints, pas tous les droits ni tous les états possibles.
- Le navigateur confirme l’usage physique de Geist pour les titres et d’Inter pour le texte de l’app. Le film de premier affichage sous préférence sombre montre un chargement initial clair sur la référence, sombre avec le candidat. Le script de thème du candidat porte le nonce de la CSP.
- Quatre routes du cockpit sont capturées séparément sur les huit variantes, avant et après : 64 captures. General Sans reste la police physique des vues. Les tailles de titre et les débordements mesurés ne changent pas. Le candidat impose le clair même sous préférence système sombre ; la racine historique devenait sombre et rendait certains contenus des cartes illisibles. Il ne s’agit donc pas d’une égalité pixel à pixel de cet ancien état sombre.
- Le contrôle manuel du clavier confirme un contour de focus visible, le changement de thème par Entrée et sa persistance après rechargement. La fumée du mouvement réduit observe 120 ms pour le corps ; elle ne certifie pas toutes les animations legacy.

### Écarts conservés et limites de preuve

Les débordements historiques ne sont pas masqués par un `overflow-x: hidden`. Sur les écrans protégés à 1280 px, le débordement global mesuré passe de 96 à 99 px avec les métriques de fonte. La fiche client à 360 px passe de 19 à 20 px ; les factures récurrentes de 70 à 71 px à 360 px et de 40 à 41 px à 390 px. Le libellé de stress de 80 caractères `W` déborde déjà fortement dans la fiche client et gagne 1 px. La navigation et les écrans doivent traiter ces cas dans leurs lots, sans présenter cette phase de fondations comme leur refonte achevée.

Les comptes et UUID des deux jeux de données sont synthétiques et distincts. Le devis candidat capturé comporte une section structurelle vide supplémentaire, sans changement de l’unique ligne facturable ni des totaux. La comparaison n’est pas une preuve de données identiques ni un diff pixel à pixel exhaustif.

Les états payants Stripe, les connexions Super PDP réelles, les notifications avec permission, la délivrabilité externe et tous les profils métier ne sont pas qualifiés ici. Les pages atteintes par redirection ne sont pas comptées comme le rendu de leur destination demandée. Les liens de signature et intervenant sont des capacités locales : les captures et journaux bruts restent privés, hors du dépôt public.

Le contrôle complet `NODE_OPTIONS=--max-old-space-size=6144 npm run check` passe : TypeScript, ESLint sans avertissement et 538 tests Vitest dans 47 fichiers. Le build conserve l’avertissement de dépréciation Next sur `middleware` ; sa migration n’appartient pas à cette refonte.

## Phase 2 : bibliothèque de composants

La phase 2 ajoute les primitives dans `src/components/ui/`. Elle ne migre ni la navigation ni les écrans métier. Leurs droits, modules, calculs, Server Actions, APIs et migrations restent inchangés. Le seul nouveau `page.tsx` est le catalogue interne explicitement prévu par le plan.

| Famille | Composants et contrat |
| --- | --- |
| Actions | `Button`, variantes primary/secondary/text/destructive, tailles visuelles 34/44/50, états disabled/loading. Le chargement bloque l’activation et la soumission sans perdre le focus. Les APIs legacy `ActionButton` et `LiquidButton` restent conservées jusqu’au nettoyage prévu. |
| Listes | `ListGroup`, `ListRow`, `CheckRow`, `Avatar`, `StatusPill`, `StatTile`. Les lignes à action sont entièrement tactiles, avec des actions de bord indépendantes, sans bouton imbriqué. |
| Champs | `Field` texte/nombre/select/textarea. `NumericInput` conserve la saisie à virgule, le bornage, l’arrondi et les émissions pendant la saisie et au blur. `UnitSelect` conserve les unités libres. Les styles explicites des appelants legacy restent prioritaires. |
| Contrôles | `SegmentedControl` à radios natifs, mode compact ou `fullWidth`, `Switch`, `FilterChips`, `SearchField`. Flèches/Home/End, focus visible et états bloqués sont exercés. |
| Surfaces | `Sheet`, deux niveaux au maximum, `AlertDialog` contrôlée pour l’irréversible et `Menu` desktop/mobile. Un menu du deuxième niveau reste un dropdown, sans troisième feuille. Radix gère les couches et le focus. `Modal` conserve son API et ses dimensions legacy. |
| Retours | `Hud` avec Annuler pendant quatre secondes, suspension au survol/focus ou sous une couche de la bibliothèque, reprise du temps restant et erreur persistante avec Réessayer ; `EmptyState`, `ErrorState`, `Skeleton`. |
| Saisie spécialisée | `AssistantField`, halo extérieur et surface de saisie opaque, avec mouvement réduit ; `Dock` sticky à largeur intrinsèque ; `SignaturePad` avec PNG opaque, repère logique et densité plafonnée. |

Le catalogue `/design` garde l’authentification existante. Il renvoie `notFound()` hors développement et en mode opérateur. Ses données sont explicitement des exemples et ses actions restent locales. Il permet de choisir clair/sombre, données vides ou textes doublés, et les états au repos/désactivé/chargement/erreur. Exception de stress déclarée : le menu répète seize fois ses libellés dans le jeu long pour exercer un débordement interne réel, y compris sur ordinateur. Aucun accès public n’a été ajouté au middleware.

Écart cosmétique conservé dans le catalogue technique : la section titrée « Sheet, AlertDialog et Menu » contient aussi le déclencheur nommé « Modal » de la démonstration de compatibilité. Cela ne masque aucune action et ne concerne pas un écran métier.

### Fidélité et adaptations déclarées

- Les formes de 28/31/32/34/38 px gardent leurs dimensions visuelles. Les contrôles disposent d’une zone tactile transparente de 44 px, sans chevauchement observé dans les cas exercés.
- Un segmenté trop long reste sur une seule rangée, avec défilement horizontal interne. La sélection défile dans son propre conteneur, sans déplacer verticalement le document. Le curseur unique reprend la carte secondaire en sombre. Il ne reçoit pas un nouveau glissement : la maquette rendue ne lance aucune animation, malgré sa déclaration CSS de 0,4 s. Le navigateur a confirmé ce comportement.
- `Sheet` est une feuille basse sous 900 px et une fenêtre centrée au-dessus. Le glissé appartient uniquement à l’en-tête mobile, hors boutons ; le corps reste scrollable. Seuil technique non dessiné : 25 % de la hauteur, plafonné à 160 px, ou vitesse supérieure à 0,5 px/ms après au moins 16 px. Une vitesse vieille de plus de 80 ms est ignorée.
- `PageSkeleton` n’est pas remplacé globalement. Son DOM et sa géométrie restent identiques. Deux rôles legacy, `--skeleton-block` et `--skeleton-line`, reproduisent exactement ses fonds Tailwind dans `:root`/`.dark`, y compris pour le cockpit qui ne reçoit pas les rôles `--at-*`.
- `SignaturePad` est déplacé vers `ui/SignaturePad.tsx`, export nommé, avec migration des trois clients et suppression de l’ancien chemin. Le papier reste blanc et l’encre sombre dans les deux thèmes. Les couleurs raster sont centralisées dans `src/lib/document/colors.ts`. Le défaut de 480×180, la capture du pointeur et le plafond de 2000×1000 sont préservés. Le contour intérieur utilise le rôle documentaire `--at-document-trait`, indépendant du thème. Les deux pages publiques passent `surface="paper"` pour garder aussi leurs textes de contrôle lisibles sur papier. Leur largeur provient de `useViewportWidth` : première hydratation identique au serveur, puis géométrie client actualisée, sans ratio CSS resté sur la largeur serveur.
- Les trois primitives Radix sont des dépendances runtime. Testing Library et jsdom sont des dépendances de développement ; seuls les tests UI utilisent jsdom. Node 24.15 minimum est déclaré pour respecter leurs moteurs. Le contrôle complet conserve le plafond mémoire de 6144 Mo déjà utilisé en CI.
- Une fermeture gestuelle refusée remet la feuille à sa position initiale. Les titres longs et boutons d’en-tête restent séparés, y compris pendant le chargement. `onAfterClose` permet d’attendre la fermeture et la restitution du focus avant une action qui supprime son déclencheur.
- Le menu choisit son mode sans divergence d’hydratation serveur/client. La fermeture, la restitution du focus puis l’action sont ordonnées, sans délai arbitraire. L’alerte ne se ferme pas automatiquement avant la décision du parent ; ses états occupés bloquent aussi Escape et Annuler.
- L’avatar vérifie les images déjà terminées avant l’hydratation. Les initiales restent visibles pendant le chargement et après un échec ; un nouveau `src` peut ensuite charger normalement.
- Le HUD est masqué sous les couches modales de la bibliothèque (`Sheet`, `AlertDialog`, `Menu` et `Modal` de compatibilité). Le voile de cette dernière porte le marqueur interne `data-atelier-modal-layer`. Le budget restant du HUD est conservé. Il doit rester monté depuis l’état fermé, au niveau page hors des fenêtres et ancêtres transformés. Deux canaux visuellement masqués et persistants annoncent respectivement le succès (`status`, `polite`) et l’erreur (`alert`, `assertive`) ; leur texte est inséré à l’ouverture ou après la fermeture de la couche bloquante, puis retiré à la fermeture. Le panneau visuel reste distinct. Une transition de retour conserve le focus sur l’action encore présente ; la fermeture restitue l’origine encore connectée, sans reprendre le focus déplacé ailleurs. Les fenêtres dessinées indépendamment dans les écrans legacy ne sont pas déclarées migrées par ce mécanisme.
- Les textes longs restent accessibles : les titres de liste ne sont pas tronqués, et le HUD peut revenir à la ligne. Les menus gardent leurs rangées sur une ligne dans un conteneur intrinsèque borné par le viewport ; le défilement horizontal interne est accessible au pointeur et aux flèches gauche/droite, sans déplacer le document. Cette priorité à l’absence de perte de texte est une adaptation déclarée, pas une copie exacte des éventuelles ellipses de la maquette.
- Le passage de `Field` en disposition empilée est réversible : sa décision repose sur les métriques de la disposition en ligne, pas sur la taille de label ou l’espacement déjà réduits du mode empilé. Le cache est actualisé en ligne et après chargement des fontes. `SearchField` rend le focus à la saisie avant le retrait de son bouton d’effacement.
- `EmptyState` et `ErrorState` demandent des textes métier explicites ; avec `ListGroup`, ils partagent le type de niveau de titre. Le catalogue utilise h3 sous ses sections h2 et h4 pour un état vide dans une liste titrée h3. L’annonce d’`ErrorState` contient le titre et la description, sans englober le bouton de reprise. Les switches du catalogue ont un libellé visible associé au bouton par `id`.
- Les styles de positionnement, de cible tactile et de focus legacy du bouton sont dans la couche `components`, sous les utilitaires des appelants. Le spinner utilise un trait CSS de 2,5 px ; le mouvement réduit supprime aussi la transformation d’appui. La feuille centrée entre à l’échelle 0,96 avec `--at-courbe-surface` : transformation sur 500 ms et fondu d’entrée distinct sur 250 ms via `--at-duree-surface-fondu`. Elle sort vers l’échelle 0,98 en 200 ms avec `--at-courbe-sortie`. Le mouvement réduit conserve seulement un fondu de 120 ms. Les coches utilisent le tracé 20→0 et le rôle `--at-courbe-coche` ; l’aura de l’assistant conserve ses arrêts canoniques et ses suggestions utilisent l’encre.

### Contraste : adaptations locales et arbitrages validés

La copie exacte de certains mélanges de la maquette échouait sur les surfaces réellement rendues, notamment les actions claires de l’alerte. Après arbitrage technique Opus 5.5 MEDIUM, cinq rôles de bibliothèque complètent les rôles existants : `--at-accent-texte-fort`, `--at-danger-texte`, `--at-danger-texte-remplissage`, `--at-encre-aide` et `--at-sens-texte-badge`. Ils renforcent les textes interactifs, les aides/placeholders et les badges sans recolorer les alias legacy, le cockpit ou les fonds canoniques translucides.

Les mesures couvrent 50 états de texte rendus en clair/sombre, dont les actions appuyées, menus, alertes, en-têtes et HUD sur papier blanc. Le minimum observé est 4,548:1. Les neuf erreurs de champs déjà passantes conservent leur couleur. Les captures de fond sont prises dans le viewport complet avec la seule encre des textes temporairement masquée, après stabilisation des transitions ; les captures de nœuds fixes transformés ne sont pas utilisées pour cette preuve.

Le propriétaire a validé les contours renforcés du switch et du curseur sélectionné du segmenté. Les contours sont intérieurs, sans modifier les dimensions ni les zones tactiles : 1,5 px pour la piste du switch et le segment sélectionné, 2 px pour le pouce. En sombre à l’arrêt, le pouce conserve un contour clair ; dans les autres états, son contour est sombre. Sur seize rendus largeur/thème/état, 96 paires de couleurs réellement peintes passent avec un minimum de 3,861:1. La mesure vérifie le noyau opaque du contour contre le fond adjacent, sans confondre les pixels d’anticrénelage avec sa couleur déclarée. Ces résultats ciblés ne constituent ni une certification AA globale ni une validation physique par lecteur d’écran.

Les seize captures ciblées des contours précèdent l’ajout du libellé visible du switch : elles prouvent ses couleurs et dimensions intrinsèques, pas la position actuelle du contrôle dans la page. Cette disposition est couverte par la matrice et les sondes tactiles actualisées.


### Qualification des composants exercée

- TypeScript, ESLint sans avertissement, 67 fichiers et 625 tests Vitest passent ; le build local de production passe.
- Onze scénarios Playwright passent ensemble sur le build de production, dont le refus 404 de `/design` après authentification. Les trois compositions exclusivement disponibles en développement y sont ignorées intentionnellement. Les quatre scénarios du catalogue passent séparément en développement : interactions et segmenté long/pleine largeur, menu au deuxième niveau puis Annuler, suspension du HUD par une feuille, glissé refusé sans déplacement résiduel.
- Matrice de 96 captures : quatre largeurs 360/390/768/1280, deux thèmes, trois jeux de données et quatre états. Aucun débordement global/non intentionnel ni bouton d’action sur deux lignes n’y a été détecté.
- 39 contrôles actifs sont sondés sur neuf points du carré de 44×44 px centré sur leur cible dans chacune des huit variantes largeur/thème, dont le déclencheur de `Modal` : aucun point manqué dans cette mesure. Les radios/checkboxes masqués sont sondés par leur label associé. Les contrôles désactivés et les surfaces purement informatives ne sont pas comptés comme actions actives.
- Huit rendus avec mouvement réduit : aucune animation infinie active dans le catalogue, transition du corps de 120 ms, focus de feuille piégé sur douze Tab puis rendu au déclencheur.
- Douze cas supplémentaires à 899/900/901 px, clair/sombre et mouvement normal/réduit, exercent le changement de mode : feuille et menu contenus dans le viewport, menu annoncé/rendu comme dialogue sous 900 et menu à partir de 900, douze Tab piégés dans la feuille et restitution exacte du focus.
- Le segmenté canonique reproduit les positions, largeurs et hauteurs de la référence à moins de 0,5 px. Son cas long conserve une piste de 32 px et des segments de 28 px.
- Les PNG réellement renvoyés par `SignaturePad` sont décodés en clair et sombre : aucun pixel transparent, de l’encre présente, ratio conservé et Effacer fonctionnel. À DPR 5, la sortie est plafonnée à 2000×750.
- Les composants `PageSkeleton` originaux et candidats sont rendus par ReactDOMServer puis dans Chromium avec leurs CSS respectifs. Fonds et rectangles sont égaux à 360/1280 en app clair/sombre et contexte cockpit clair. Cette comparaison contrôlée n’est pas présentée comme une nouvelle capture complète du cockpit en fonctionnement.
- Le HUD conserve son temps restant pendant le survol, le focus et l’ouverture d’une nouvelle feuille. Les deux ordres de composition sont exercés ; Annuler redevient accessible après fermeture de la feuille. Le retour du focus est aussi vérifié pour Annuler et Réessayer.
- Les deux pages publiques de signature, devis et contrat réellement publiés dans la base locale, sont exercées sans cookie dans seize variantes : quatre largeurs et deux thèmes. Tracé, Effacer, PNG opaque et contour documentaire sont vérifiés ; l’écart relatif maximal entre ratio rendu et raster est inférieur à 0,25 %, sans avertissement d’hydratation dans ces captures. Seul le parcours devis possède en plus un test E2E permanent ; la preuve du parcours contrat repose sur ses cas natifs.
- Les transitions du HUD conservent les mêmes canaux DOM fermés/ouverts/succès/erreur, suspendent leur texte sous une feuille puis le réinsèrent après plus de quatre secondes. Les huit variantes largeur/thème de `Modal` sont aussi exercées : la régression consommait réellement le délai sous son voile avant correction ; le budget et l’annonce sont maintenant suspendus puis repris. Les tests de composant couvrent les deux ordres d’ouverture. Aucune de ces preuves ne mesure la restitution audio d’un lecteur d’écran physique.
- Huit menus à libellés de stress réellement débordants exercent les flèches gauche/droite, sans déplacement du document : rangées de 44 px sur une ligne, icônes alignées et focus rendu. Le retour long→court et étroit→large de `Field` conserve le focus ; le clic sur le libellé visible d’un switch agit, sauf dans son état bloqué.
- Le vrai bouton `ActionButton` de la modale d’équipe est contrôlé sur huit variantes. Une comparaison temporaire de sa seule contribution CSS avec la classe `relative` historique conserve les dimensions, fontes, fond et rayon calculés ; ses neuf points tactiles passent. Ce n’est pas une nouvelle comparaison complète de l’app de référence. Aucun enregistrement d’équipe n’est soumis.
- Le CLI ESLint installé rejette une couleur CSS littérale sur stdin avec `atelier/no-hardcoded-colors` et accepte le rôle équivalent ; aucune fixture de sonde n’est ajoutée au dépôt.

Captures, CSS compilés de comparaison, journaux et traces de modèle restent privés. Les tests purement visuels de copie de libellé ou de comptage de div ont été supprimés ; le parcours clavier des affichages est couvert ensemble, et leurs dimensions/couleurs sont vérifiées dans le navigateur.

### Limites conservées

Les écrans legacy ne deviennent pas conformes aux maquettes par l’ajout de cette bibliothèque. Le catalogue démontre plusieurs variantes pleines sur une même page ; cette démonstration de développement n’est pas un écran métier soumis à la règle d’une seule action pleine.

[INFERENCE] Défauts hérités repérés par lecture, non reproduits dynamiquement ici : la valeur brute de `NumericInput` peut masquer une mise à jour externe après le premier focus ; `ActionButton` peut laisser une Promise rejetée issue de `finally()` sans gestionnaire ; le canvas de signature peut être réinitialisé au retour de sa propre valeur, redessiné par un chargement d’image tardif après Effacer, conserver un indicateur de dessin après un `null` externe ou accepter un clic sans tracé. Ces hypothèses ne sont pas décrites comme de nouvelles régressions ni comme des correctifs de cette phase.

L’audit des dépendances runtime remonte zéro vulnérabilité. L’audit complet signale une alerte minimatch affectant l’outillage ESLint de développement, soit quatorze entrées modérées ; les versions concernées étaient déjà identiques avant les ajouts UI. Aucun forçage de version majeure ni retour à un ancien ESLint n’a été appliqué.

Safari/iOS physiques, tous les profils métier, Stripe payant, PDP réelle, délivrabilité externe, micro et push ne sont pas qualifiés par cette phase. Aucune fusion ni mise en production n’est autorisée par ces résultats.

