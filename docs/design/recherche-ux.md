# Recherche UX : motifs retenus pour Atelier

Ce document garde la trace des sources qui ont guidé la refonte et de ce qu’on en a retenu. Les sources sont citées par leur titre et leur éditeur ; les formulations sont des résumés, jamais des citations. À relire avant d’en tirer des règles pour d’autres produits.

## Sources internes

- Skills Apple de l’équipe (`apple-ecosysteme`, `apple-socle`, `apple-ux-ui-quality-gates`) : 12 invariants d’expérience, références de parcours, d’écriture et de mouvement, portes qualité qui exigent des preuves (captures, mesures) et non un avis.
- `atelier-ux-patterns` : règles propres au produit (pas de 3D, icônes maison, une action principale, tableaux responsive).

## Sources externes

| Source | Ce qu’on en a retenu | Où c’est appliqué |
| --- | --- | --- |
| Apple Human Interface Guidelines, *Sidebars* et *Tab bars* | Une barre d’onglets d’abord ; une barre latérale quand la hiérarchie est profonde ; mêmes lieux sur les deux. | `TabBar` (téléphone, cinq lieux), `Sidebar` (ordinateur) |
| Apple HIG, *Sheets*, *Alerts*, *Lists and tables* | La feuille pour créer et modifier (Annuler à gauche, action à droite, action grisée tant que la saisie est invalide) ; l’alerte réservée à l’irréversible ; la liste groupée pour les réglages. | `Sheet`, `AlertDialog`, `ListGroup`, Réglages en liste groupée |
| Apple HIG, *Accessibility* et *Motion* | Cibles de 44 pt, contraste, mouvement réduit respecté. | cibles de 44 px, `src/lib/motion.ts` |
| Nielsen Norman Group, *Progressive disclosure* | Deux niveaux au plus ; le fréquent devant ; un moyen visible d’ouvrir le reste. | « Plus d’options » dans l’éditeur de devis, segments de la fiche chantier, réglages en sous-pages |
| Nielsen Norman Group, *Bottom sheets* | La feuille du bas pour une tâche courte, avec une sortie évidente ; pas de feuille sur feuille au-delà de deux niveaux. | `Sheet` (deux niveaux au plus, vérifié à l’exécution) |
| Nielsen Norman Group sur la lecture à l’écran | Les gens scannent : peu de mots, des repères visibles, des chiffres concrets. | cartes de prix, titres qui disent l’état |
| Linear | Ne pas réclamer une attention qu’on n’a pas méritée ; interface optimiste ; raccourcis clavier. | cloche regroupée par sujet, `Hud` avec « Annuler », ⌘K et N |
| Stripe | Peu de chiffres à l’accueil ; des états vides soignés autant que des états pleins. | Aujourd’hui (trois chiffres au plus), `EmptyState` |
| Concurrents BTP (Obat, Tolteck) | Devis rapide sur chantier, signature, hors ligne. | départs du devis (dicter, décrire, importer, partir de zéro), signature du client |

## Motifs adoptés

1. **Lieux plutôt que fonctions** : Aujourd’hui, Documents, Chantiers, Clients, Entreprise. Une fonction rare ne disparaît pas, elle descend d’un niveau.
2. **Un bouton plein par écran** : l’œil sait où cliquer. Les autres actions sont grises, en texte ou dans un menu.
3. **Suppression sans friction quand elle est réversible**, avec un retour de quatre secondes ; alerte seulement quand on ne peut pas revenir en arrière.
4. **Le titre dit l’état** : « 3 devis attendent » plutôt que « Tableau de bord ».
5. **Une seule assistante**, qui annonce ce qu’elle va faire avant d’agir sur l’extérieur.
6. **Écrire pour le scan** : un chiffre, un verbe, pas de jargon. Aucun nom de fournisseur technique dans l’interface d’un client.
7. **Des états complets** : vide, chargement, erreur, réussite, hors ligne, accès réservé.

## Ce qu’on n’a pas fait (et pourquoi)

- Pas de mode hors ligne complet : demande une file de synchronisation côté serveur, hors périmètre de la refonte.
- Pas de glisser-déposer généralisé : gardé là où il existait (tâches d’un chantier).
- Les sources externes n’ont pas été relues à la date de rédaction ; avant de les citer à des clients, vérifier les pages d’origine.
