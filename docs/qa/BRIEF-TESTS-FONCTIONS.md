# Brief de test des fonctions : Atelier by Orsayn

À l'attention de l'agent de test (oh my pi). Objectif : s'assurer que chaque fonction de l'app marche vraiment, pour que l'entreprise puisse reprendre le marketing. Le design et l'expérience visuelle sont traités ailleurs (autre agent) : **ne pas toucher à l'apparence**, seulement signaler ce qui est cassé ou faux.

Mis à jour le 9 novembre 2026, après la refonte (PR 90, 92, 93, 94) et la réparation de la base de production (migration 217).

## 1. Règles

- **Production = `https://app.atelier-btp.fr`** (instance mutualisée, vrais clients dans des organisations isolées). Ne rien envoyer à un vrai client, ne rien facturer, ne supprimer que ce que vous avez créé.
- Le compte de test de production est celui de **Weber Tôlerie** (demo@weber-tolerie-demo.fr). Le mot de passe est donné par le propriétaire, jamais écrit dans un fichier, un commit ou un rapport.
- Tout ce qui peut envoyer un e-mail, un SMS ou un paiement se teste **en local** (boîte de capture à la place de Resend), pas en production.
- Test local : `scripts/e2e-qualification-server.mjs` (Supabase local migré, port 3456). Commandes dans `docs/design/GUIDE-REPRISE-AGENTS.md` §7. Node 24 obligatoire.
- Un test de plus de 5 minutes sans résultat : s'arrêter et le signaler.
- Ne jamais committer `.env`, `design/`, `artifacts/`, ni un mot de passe.
- Pas de modification du code serveur (`src/lib/data/**`, `src/app/api/**`, `supabase/`) sans en parler au propriétaire : signaler le défaut avec sa cause probable.

## 2. Défaut déjà rencontré en production (à connaître)

La base de production avait un retard sur ses propres migrations (colonnes `facturx_*`, échéancier de paiement). La migration 217 l'a réparé. **Chercher d'autres écarts du même genre** : toute action qui échoue avec « Erreur lors de… » en production mais passe en local est suspecte. Comparer le schéma de production et celui de la base locale (`information_schema.columns`, `pg_policies`, `pg_proc`) est la méthode qui a trouvé le défaut.

## 3. Déjà vérifié (inutile de refaire, sauf régression)

- Production, compte Weber : connexion ; devis (section, ligne, totaux, enregistrement) ; facture (ligne, brouillon) ; échéancier ; enregistrement des réglages Entreprise ; PDF de devis et de facture servis (200, `%PDF`).
- Local : inscription avec code reçu ; onboarding et invitation d'équipe ; réglages Entreprise, Paiement, Légal, Devis ; archive d'un compte neuf ; rapports ; formulaire public et soumission ; upload de photo de chantier ; Factur-X (schéma, schematron, PDF/A-3b par veraPDF).
- 729 tests Vitest et 4 suites E2E ciblées.

## 4. À tester (par ordre de priorité)

Pour chaque ligne : noter « OK », « KO » (avec la reproduction et le message exact), ou « non testable » (avec la raison).

### A. Parcours qui rapportent de l'argent
1. **Envoyer un devis** (local) : e-mail capturé, lien de signature, signature par le client (page publique), le devis passe à « accepté », le PDF signé.
2. **Transformer un devis accepté en facture**, puis **émettre la facture** (« Valider et envoyer ») : numéro attribué, `issuance_snapshot`, e-mail, PDF Factur-X.
3. **Encaisser** : enregistrer un paiement, une échéance de l'échéancier (`record_invoice_schedule_payment`), un paiement partiel, un trop-perçu refusé. La facture passe à « payée ».
4. **Relances** : configuration, envoi manuel d'une relance, déclenchement par le cron (`CRON_SECRET` requis), pas de doublon.
5. **Facture d'acompte, avoir, facture récurrente** : création, numérotation, cohérence des totaux.
6. **Autoliquidation de TVA** et taux multiples : les totaux du PDF correspondent à ceux de l'écran.

### B. L'assistante Sarah
7. Préparer un devis par texte, par dictée (si le micro est disponible), par import de document. Elle **montre ce qu'elle va faire avant d'agir** ; vérifier qu'aucune action externe ne part sans confirmation.
8. Quota de Sarah : message clair quand il est atteint ; clé d'assistante client (réglage Abonnement).
9. Sarah dans le catalogue (« Demander à Sarah ») et dans les chantiers. Le module IA désactivé masque bien les entrées.
10. Aucune réponse de Sarah ne nomme un fournisseur technique (OpenRouter, etc.).

### C. Clients, chantiers, équipe
11. Créer client, contact, chantier ; rattacher un devis ; fiche chantier : Travaux, Équipe, Argent, Photos (réception comprise).
12. Pointage des heures, planning, affectation d'une équipe, droits d'un collaborateur (le rôle Owner de Weber n'a pas `chantiers.manage_team` ni `chantiers.pointage` : dire si c'est voulu).
13. Entretien et contrats : création, échéances, génération des interventions.
14. Invitation reçue (`/invite/accept`) : lien du mail, création du compte, rôle appliqué.

### D. Paiement et abonnement
15. Stripe (clés d'essai nécessaires) : choix de formule, portail, résiliation, achat « setup », régularisation. **Ne pas utiliser de vraie carte.**
16. Super PDP : connexion, réception et transmission de factures électroniques.

### E. Données et conformité
17. Archive et export FEC sur un compte dont les documents ont été émis par l'app. Sur un **compte de production ancien**, l'erreur « Aucune autorité historique vérifiée » est connue : dire quels comptes sont concernés.
18. Export comptable, sauvegarde, fermeture de compte (ne pas la lancer en production).
19. Cours des métaux : les cours affichent « Mis à jour le 01/09/2026 », la clé `METALPRICEAPI_KEY` manque probablement. Vérifier le cron et le message affiché.

### F. Pages publiques et robustesse
20. Formulaire de demande de devis, signature, espace intervenant, mon-espace : un lien expiré, un lien déjà utilisé, un mauvais identifiant.
21. Permissions : un collaborateur ne voit pas ce qu'il ne doit pas voir ; deux organisations ne voient jamais les données de l'autre (RLS).
22. Hors ligne et session expirée : messages clairs, aucune perte de saisie.
23. Aperçu PDF : dans le navigateur intégré de l'app de bureau, l'aperçu PDF ne s'affiche pas et bloque les actions suivantes jusqu'au rechargement (le serveur répond bien 200). À reproduire dans un vrai Chrome et un vrai Safari mobile ; signaler si c'est aussi cassé.

## 5. Format du rapport

Un fichier `docs/qa/RAPPORT-<date>.md` avec : un tableau (numéro, résultat, preuve), puis la liste des défauts classés **bloquant / gênant / mineur**, chacun avec : où, comment le reproduire, message exact, cause probable. Terminer par « ce que je n'ai pas pu tester et pourquoi ». Ne pas écrire « tout est bon » : écrire ce qui a été prouvé.
