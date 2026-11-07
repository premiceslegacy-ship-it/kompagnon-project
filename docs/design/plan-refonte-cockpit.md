# Plan : refonte du cockpit Orsayn (`/orsayn`)

Statut : plan à valider par le propriétaire, aucune ligne de code écrite. Rédigé le 7 novembre 2026, après la mise sur `main` de la refonte de l'app (phases 1 à 6).

## 1. Pourquoi

Le propriétaire est le seul utilisateur du cockpit et ne le comprend pas : « je ne comprends pas qui, quoi, quoi faire ». Le constat à la lecture du code (`src/app/(app)/orsayn/`, environ 5 800 lignes) confirme le ressenti.

- **L'accueil dit tout et ne dit pas quoi faire.** `Dashboard.tsx` empile une bande d'alertes, quatre chiffres, deux courbes et répartitions (coût par fonction, coût par modèle), deux classements (clients les plus consommateurs, marge à surveiller) et des recommandations : une douzaine de blocs de même poids. Le titre « Bonjour, voici la vue d'ensemble » ne dit pas l'état.
- **Le vocabulaire est celui du code, pas celui du travail.** « Configuration à vérifier », `source_instance`, `config_sync_status`, « instance », « organisation », « forfaits renseignés », « Pricing & IA ». Un client est tantôt une instance, tantôt une organisation, tantôt une fiche.
- **La fiche client est une suite de formulaires.** Cinq onglets (Offre, Dossier setup, Consommation, Modules, Historique), des formulaires longs, des étiquettes d'état (synchronisation, facturation électronique) sans verbe, et une suppression par saisie du nom au même niveau que le reste.
- **Aucune action principale.** Rien n'indique, pour un client donné, la prochaine chose à faire : activer le setup, relancer un essai, vérifier un paiement, renvoyer la configuration.
- **Deux langages visuels.** Le cockpit garde l'ancien système (`.cockpit-*`, `--cockpit-*`, `--bg-base`, General Sans, thème clair, icônes Lucide) alors que l'app a un système propre (`--at-*`, composants `ui/`).
- **Des fichiers morts.** `CockpitTabs`, `ClientsTable`, `ClientDrawer` et leurs onglets sont des restes de l'ancienne version (listés « non atteints » dans `DEPLOIEMENT_CLIENT.md`).

## 2. Principe directeur : trois questions par écran

Chaque écran répond, dans l'ordre et sans lire plus de trois lignes :

1. **Qui ?** Le client concerné, avec son offre en un mot (Setup, Pro, Expert, Essai).
2. **Quoi ?** L'état en une phrase (« Essai terminé depuis 2 jours », « Paiement refusé le 4 novembre », « Setup payé, à activer »).
3. **Quoi faire ?** **Un seul bouton plein**, un verbe (« Activer le setup », « Relancer par email », « Renvoyer la configuration »). Le reste est derrière « Plus ».

Les règles de l'app s'appliquent : une chose par écran, un seul bouton plein, peu de mots, des chiffres palpables, des feuilles pour créer et modifier, `Hud` pour l'annulable, `AlertDialog` pour l'irréversible. Voir `docs/design/GUIDE-REPRISE-AGENTS.md`.

## 3. Phase 0 : comprendre le travail réel (avant tout dessin)

Entretien court avec le propriétaire, pour lister les **tâches réelles** et leur fréquence. Hypothèse de départ à confirmer ou corriger :

| Tâche | Déclencheur | Ce qu'il faut voir | Action attendue |
|---|---|---|---|
| Activer un client setup | Il a payé ou demandé l'accès | Entreprise, référence de règlement, offre | Activer le setup |
| Suivre un essai | L'essai se termine | Date de fin, usage | Relancer, proposer une offre |
| Traiter un paiement refusé | Alerte de paiement | Montant, date, client | Écrire au client |
| Vérifier une configuration | Synchronisation en échec | Ce qui n'a pas été envoyé, depuis quand | Renvoyer |
| Surveiller le coût IA | Un client consomme beaucoup | Coût du mois, marge | Ajuster le forfait ou prévenir |
| Écrire à un client | Alerte commerciale | Brouillon proposé | Envoyer |
| Suivre l'argent | Fin de mois | Revenus, coût IA, marge | Aucune (lecture) |

À obtenir aussi : les mots que le propriétaire emploie pour chaque chose (pour remplacer instance / organisation / synchro), les décisions de la semaine, ce qu'il n'ouvre jamais (à ranger ou supprimer sans perte de fonction).

**Prérequis technique :** le cockpit ne fonctionne qu'en `OPERATOR_MODE=true` avec le projet Supabase « operator » (migrations dans `supabase/operator-migrations/`). Il faut un jeu de données local (clients de tous les états : setup à activer, essai qui se termine, paiement refusé, synchronisation en échec, client sans activité) pour tester sans toucher la production. Le construire fait partie de cette phase.

## 4. Architecture cible (à valider sur maquette)

Quatre lieux, comme l'app (même `Sidebar` et `TabBar`) :

- **Aujourd'hui** : la file des choses à faire, une ligne par client concerné (Qui, Quoi, bouton). Trois chiffres au plus en tête (revenus du mois, coût IA, marge). Tout est à jour = un état vide soigné.
- **Clients** : liste groupée avec recherche, filtres par état (à activer, essai, paiement, configuration), une pastille et la prochaine action par ligne.
- **Fiche client** : en-tête (nom, offre, état en une phrase, bouton principal) puis segments **Offre**, **Accès** (modules), **Consommation**, **Historique**. Le dossier setup devient un bloc de **Offre** quand le client est en setup. Suppression et archivage dans « Plus », avec `AlertDialog`.
- **Messages** : alertes commerciales à valider, brouillons, envoyés. Un brouillon proposé s'ouvre dans une feuille avec un seul bouton « Envoyer ».

« Pricing & IA » et les graphes de coût par fonction et par modèle passent dans un détail ouvert depuis « Consommation » : utiles pour décider, pas pour ouvrir la journée.

## 5. Décisions à prendre avec le propriétaire

1. **Langage visuel** : (a) adopter les jetons et composants de l'app (`--at-*`, `ui/`) avec l'accent et le logo Orsayn par-dessus, un seul système à maintenir (recommandé) ; (b) garder le langage Orsayn (General Sans, six couleurs, voir le skill `orsayn-design-language`) en le reconstruisant sur les composants de l'app. Dans les deux cas, plus de `.cockpit-*` à la fin.
2. **Thème** : clair seulement (aujourd'hui) ou clair et sombre comme l'app.
3. **Ton** : le cockpit tutoie (« Suis tes clients »). L'app vouvoie. À trancher.
4. **Mobile** : l'app est à égalité téléphone et ordinateur ; le cockpit doit-il l'être (activer un client depuis le téléphone) ?

## 6. Méthode et phases

Même méthode que l'app. Un lot par écran, une PR par lot, vérifiée avant la suivante.

1. **Phase 0** : entretien, vocabulaire, jeu de données local, mesure de l'existant (blocs, boutons, couleurs en dur, nombre d'appuis pour « activer un setup »).
2. **Phase 1 : maquettes** (HTML cliquable, publiées en Artifact) des quatre lieux et de la fiche, téléphone et ordinateur, clair et sombre. Validation du propriétaire avant tout code.
3. **Phase 2 : fondations** : décision sur les jetons ; extraction de la logique de `data.ts` et `utils.ts` en modèles testés (`cockpitModel.ts`) ; textes de statut dans un seul fichier.
4. **Phase 3 : écrans**, dans l'ordre : Aujourd'hui, Clients, Fiche client (Offre, puis Accès, Consommation, Historique), Messages. Le dossier setup (`SetupIntakeDossier.tsx`, `setup-intake-*`) garde ses règles et ses tests ; seul l'affichage change.
5. **Phase 4 : nettoyage** : suppression des modules morts et des classes `.cockpit-*`, mise à jour de `docs/design-system.md` (§9) et du guide.

**Règles à ne pas enfreindre** : les server actions et `data.ts` ne changent pas de comportement (`actions.ts`, 1 137 lignes, est le contrat avec l'API cockpit et les webhooks) ; aucune action perdue (activation setup, archivage, suppression, envoi de configuration, emails) ; les migrations `supabase/operator-migrations/` ne bougent pas ; l'accès reste réservé aux adresses de `OPERATOR_ALLOWED_EMAILS`.

## 7. Fini quand

- Pour chaque écran : un seul bouton plein, une phrase d'état, zéro couleur en dur, captures à 390 et 1280 px en clair (et sombre si décidé), parcours au clavier.
- Le propriétaire ouvre le cockpit et sait, en dix secondes, **qui** doit être traité, **pourquoi**, et **quoi faire**.
- « Activer un client setup » se fait en trois appuis au plus depuis l'écran Aujourd'hui.
- Plus aucune classe `.cockpit-*` ni jeton `--cockpit-*` hors `globals.css` historique supprimé.
