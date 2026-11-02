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

La règle `atelier/no-hardcoded-colors` est activée dans les fichiers portant le commentaire `@atelier-migrated`. Elle couvre les classes de palette, les couleurs littérales de style et les attributs SVG, y compris les constantes locales partagées. Les références SVG `url(#…)` ne sont pas des couleurs littérales.

Ce contrôle n’est pas une preuve d’analyse exhaustive des valeurs importées ou calculées dynamiquement. La lecture du code et la vérification visuelle restent nécessaires. Les écrans legacy ne sont pas déclarés migrés simplement parce qu’ils héritent des nouveaux alias.

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
