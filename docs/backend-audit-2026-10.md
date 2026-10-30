# Atelier — revue technique et durcissement du 27 octobre 2026

## Conclusion et périmètre

Le lot de code a été corrigé et exercé localement : isolation, permissions, documents fiscaux, signatures publiques, paiements, effacement, Storage, quotas, intégrations opérateur, dépendances et livraison. Il ne constitue pas une certification d’absence de vulnérabilités ni une qualification réglementaire.

Au terme de la revue initiale du 27 octobre, aucun déploiement, aucune migration distante, rotation de secret ou réécriture Git n’avaient été effectués. Ses preuves portaient sur le working tree et son Worker OpenNext local. Les modifications préexistantes de l’utilisateur ont été conservées. La refonte visuelle n’est pas entreprise dans ce lot.

Exécution et contre-revues finales : rôles Codex GPT 6 Luna xhigh et GPT 6.1 Sol high. Les avis des reviewers ne remplacent pas les scénarios exécutés par le parent.

## Préparation de production du 30 octobre 2026

Les contrôles suivants sont postérieurs à la revue initiale. Le code et le schéma renforcés ne sont pas encore déployés en production ; les opérations distantes autorisées sont distinguées des répétitions locales ci-dessous.

- Cibles vérifiées depuis les paramètres Workers : `atelier-app` (`app.atelier-btp.fr`) utilise `pyxnmohknxmbpbcuvudg` ; `orsayn-cockpit` utilise `ghkacozmtvvmlbbwwnlp`. Versions de retour applicatif relevées : `be938570-f7bd-4eb0-87fd-17354fb9f3b2` et `b58caa39-96fd-4c94-9ce2-481287aeb34a`. Un retour de code ne remplace pas une reprise de données.
- Sur Atelier, l’historique distant ne contient aucune des migrations 193–214. L’API des sauvegardes retourne `backups: null` et `pitr_enabled: false` ; elle ne fournit donc pas ici de point de restauration vérifié.
- Une sauvegarde préliminaire du schéma, des données, des rôles et des 12 objets Storage a été créée dans le dossier privé `~/.private/atelier-release-20261030`. Les données et fichiers sont chiffrés en AES-256-GCM avec dérivation HKDF-SHA256 dédiée depuis la clé applicative locale existante ; aucune valeur de clé n’est consignée. Le manifeste précise la référence de récupération : conserver la valeur de clé d’avant livraison. Il s’agit d’un relevé en activité, pas d’un snapshot final sous maintenance.
- Le schéma et les données ont été restaurés dans la base locale isolée `atelier_release_rehearsal_20261030`, non desservie par le PostgREST local habituel. Les 12 fichiers (20 495 952 octets) ont été récupérés sur disque privé et leurs SHA-256 vérifiés ; les copies déchiffrées de contrôle ont ensuite été supprimées. Ce contrôle des fichiers n’est pas une restauration dans le service Storage distant.
- Un premier dump des rôles a échoué ; une relance séparée a réussi et son résultat a été chiffré et vérifié. La cause du premier échec n’est pas établie ; il n’est pas effacé du bilan.
- Les 22 migrations 193–214 ont été appliquées sur cette copie locale. Les comptes sont restés à 21 organisations, 32 factures, 106 devis, 4 contrats, 8 utilisateurs Auth et 12 métadonnées Storage. Aucun historique de migration distant n’a été modifié.
- Impact observé sur cette copie : révocation de 14 tokens de devis et 4 de contrats ; retrait d’une publication de contrat non signé. Les 16 factures émises n’ont pas de snapshot d’émission, ni de référence PDF ou XML en base ; 2 contrats signés n’ont pas de snapshot PDF. Aucun original n’a été reconstruit depuis les coordonnées actuelles.
- Le gate Storage a été exercé avec l’autorité `service_role` et refuse la bascule (`P0001`) : un objet de `quote-attachments` n’a pas de registre de propriété. Aucun mapping n’a été inventé, aucun objet déplacé ou supprimé.
- Le premier accès Management API au cockpit recevait 403. Une connexion interactive autorisée dans un profil JSON distinct a rétabli l’accès d’administration au seul projet attendu. La sélection de profil par défaut a été restaurée ; aucun token n’a été affiché.
- Schéma, données et rôles du cockpit ont été sauvegardés et restaurés dans une seconde base locale non desservie par PostgREST. Son historique distant comporte 001–012 et 017 ; des DDL 013–016 existent hors historique. La répétition de 013–016 puis 018–019 a abouti à 19 versions, avec empreintes et comptes inchangés pour les 47 tables préexistantes. La fixture 019 a réussi ; cette copie contenant les données a ensuite été supprimée.
- Le préflight n’exige plus les credentials Stripe du cockpit sur une app self-service. Le préparateur Cloudflare filtre les credentials centraux selon la cible, conserve le mode client explicite et refuse une cible/mode contradictoires avant écriture. Six scénarios synthétiques des CLI réels ont réussi, sans appel fournisseur. Les deux prix Stripe existants sont actifs en mode live et les domaines Resend répondent `verified` ; ces GET ne qualifient pas Checkout, webhook ou livraison email.
- Sous Node 24.22.1, le typage froid a d’abord dépassé le heap par défaut. Avec le budget de 6 Gio déjà utilisé pour la livraison, typage, lint, 492 tests dans 37 fichiers et audit des dépendances de production ont réussi ; zéro vulnérabilité signalée par cet audit. Le job CI explicite désormais ce budget mémoire.
- Une nouvelle instance Supabase jetable a appliqué les 215 migrations ; 65 tests d’isolation et les 12 fixtures SQL principales ont réussi. Une base séparée a exécuté les 19 migrations opérateur et la fixture 019.
- Le nouvel artefact cible `atelier-app` a été construit avec Next 16.4.3/OpenNext 1.20.13. Aucun des credentials opérationnels connus recherchés n’a été retrouvé dans ses 3 462 fichiers ; ce contrôle ciblé n’est pas une preuve générale d’absence de secret.
- Le Worker construit a servi un parcours navigateur local : connexion A, tableau de bord et facturation ; PDF de la facture A en 200, puis même PDF refusé en 404 au tenant B. Une première connexion a reçu 500 car la configuration locale omettait `RATE_LIMIT_SECRET` ; une clé synthétique a permis la reprise. Les appels analytics et icônes hors du périmètre local ont échoué ; aucun envoi fournisseur n’a été effectué.
- Le cockpit et son unique connexion OAuth PA sont actuellement en sandbox. L’indicateur `SUPER_PDP_ENV=production` du Worker app n’est pas consommé par ses chemins client : il ne prouve aucune qualification PA de production. La sonde exploratoire historique, qui journalise les réponses OAuth et n’impose pas réellement une sandbox, n’a pas été exécutée.

- Inventaire historique avec Gitleaks 8.30.1 temporaire, archive Darwin arm64 vérifiée par SHA-256 depuis la release officielle : 133 commits examinés, 22 constats expurgés. Les trois caches contenaient trois capacités de devis distinctes dans leurs URL, appariées à trois devis de la base Atelier sans afficher leurs valeurs.
- Après autorisation explicite, ces trois capacités ont été révoquées en production. La requête a confirmé trois lignes visées, trois révocations et des empreintes identiques pour tous les autres champs des devis hors métadonnées de mise à jour. Les trois anciennes URL répondent désormais 404 aux requêtes HEAD ; un lien de devis non touché répond 200. Aucun document n’a été téléchargé et aucun email envoyé. Une première requête avait été rejetée pour erreur de syntaxe avant mutation ; l’alias SQL réservé a été corrigé, puis la révocation contrôlée a réussi.
- L’utilisateur a confirmé que l’intégralité de l’historique documentaire concerné est fictive. Cette déclaration ne transforme pas les anciennes pièces en originaux vérifiés et n’autorise aucune suppression. Les anciennes pièces restent conservées avec leur niveau de preuve réel.
- Recontrôle opaque de `.env.local` : la clé `OPERATOR_SUPABASE_SERVICE_ROLE_KEY` est bien présente, porte le rôle JWT `service_role` et vise le projet cockpit attendu. Cet accès applicatif REST ne fournit ni token personnel Management API ni chaîne de connexion PostgreSQL d’administration. Les valeurs des credentials n’ont pas été affichées.
- L’historique Git a été sauvegardé dans une archive chiffrée vérifiée, puis réécrit dans un clone séparé pour retirer uniquement `.next/`. L’arbre hors cache a été comparé à l’original. Les scans de l’historique nettoyé et du premier delta stagé n’ont signalé aucun secret après les trois exceptions bénignes déjà revues, remappées aux nouveaux commits.
- Après accord, `main` a été remplacée par `630686a2c8e368c06bc0c9a976bd245e68b2cc89` avec un bail portant exactement sur l’ancienne SHA. Le working tree d’origine n’a pas été réinitialisé. Le lot de code renforcé est préparé séparément sur `release/backend-hardening-20261030`.
- `main` exige désormais PR et contrôle CI émis par GitHub Actions, y compris pour les administrateurs ; force-push et suppression sont interdits. L’environnement `Atelier CDF` exige une validation du propriétaire et n’admet que `main`. Le contournement administrateur a été désactivé dans l’interface et son état revérifié après rechargement ; l’auto-validation reste possible pour l’unique propriétaire.

- Après validation, la base locale contenant les données restaurées, le dump de schéma en clair, les fichiers déchiffrés de contrôle et les outils temporaires ont été supprimés. Les sauvegardes chiffrées et le manifeste privé restent disponibles ; la base locale préexistante n’a pas été réinitialisée ni supprimée.

**Décision actuelle : pas de bascule distante du schéma ou du code** avant résolution de la pièce jointe sans propriétaire prouvé, accord sur la maintenance et ses effets sur les autres liens/publication, et qualification des intégrations fournisseurs. L’administration cockpit et la réécriture/protection Git sont débloquées. Les trois capacités autorisées ont été révoquées ; les autres données de production restent inchangées. Les quatre workflows de déploiement restent suspendus ; la CI reste active.

## Correctifs structurants

| Domaine | Défaut ou risque traité | Décision |
|---|---|---|
| Isolation et autorisations | RPC réouvertes, modifications de rôles/memberships, champs serveur et références entre organisations | Restrictions DB, permissions métier, contrôles des transitions, `search_path` explicite et vérification de l’organisation sur les chemins privilégiés |
| Documents émis | PDF/XML recalculés depuis des parties ou un régime de TVA mutables | Capture transactionnelle des faits à l’émission ; consommateurs PDF/XML/PDP fondés sur l’autorité persistée |
| Historique | Anciennes pièces sans original vérifiable et imports historiques pris pour une émission prouvée | États non vérifiés explicites ; pas de backfill d’« originaux » avec les coordonnées courantes ; conservation privée distincte du dernier contexte connu |
| Renvois et relances | Renvoi d’une facture payée confondu avec son cycle financier ; délais de relance calculés sur le mauvais événement | Revendication de renvoi séparée, conservation des montants/dates/statuts ; calcul selon émission ou échéance suivant la règle métier |
| Encaissement manuel | Deux appels pouvaient insérer deux paiements tout en conservant un seul total sur la facture | RPC authentifiée `mark_invoice_paid`, verrou et transaction uniques pour paiement, total, statut et date ; effets applicatifs seulement pour une transition effective |
| Rapport mensuel | Archiver une facture émise retirait ses montants et son encaissement de l’export | L’archivage reste une préférence de visibilité, pas une annulation comptable ; factures émises archivées incluses dans le rapport et son contrôle d’autorité |
| Publication et consentement | Contrat et devis dissociables, publication périmée ou remplacée pendant la signature | Publication scellée, préparation CAS, consentement atomique, contrôle de fraîcheur et reçus en lecture seule |
| Vérification des sceaux | JSON transformait `120.00` en `120`, invalidant un contrat + devis pourtant valide en base | Vérification contre la ligne persistée ; égalité JSONB des faits reçus et hash calculé depuis les valeurs DB originales ; aucun rescellement de l’historique |
| Pièces jointes | Propriété déduite d’un slug réutilisable, fichiers publics et réconciliation ambiguë | Namespace UUID immuable, registre privé d’appartenance, routes authentifiées, migration explicitement réconciliée et garde avant perte des preuves |
| Effacement | Reprises incomplètes, capacités publiques survivantes, courses avec activation d’identité ou adoption d’un logo | Révocation, nettoyage séparé et reprenable, revendications durables d’identité et d’objet, conservation des références encore légitimes |
| Images et exports | Un chargeur PDF contournait le validateur d’URL ; lectures de faits téléchargeant inutilement des logos | Chargement centralisé inline/Storage configuré, limites de flux et dimensions, pas de repli vers l’URL rejetée ; DTO documentaires sans credentials |
| Quotas et opérateur | Réservations concurrentes, secret partagé et cible contrôlée différente de celle déployée | Réservation atomique, refus fail-closed, HMAC par instance, idempotence métier et identité de cible cohérente entre configuration, contrôles et exécution |

### Migrations et conservation

- Appliquer la chaîne principale manquante dans l’ordre jusqu’à **214** ; le lot d’audit couvre **193–214**. Le schéma de test jetable a été reconstruit puis porté jusqu’à cette version.
- Réconcilier les versions 013–016 du cockpit avec le catalogue réel, puis appliquer **018–019** et consigner l’historique avant les flux concernés. Cette séquence a été répétée sur sa copie restaurée ; elle n’a pas encore été exécutée à distance.
- `204–209` encadrent autorité fiscale, renvoi, historique et publication/signature ; `210–211` les revendications d’identité et de logo ; `212` l’appartenance des pièces jointes et le cutover ; `213` l’encaissement atomique ; `214` la vérification des publications persistées.
- Un snapshot de faits ne promet pas un PDF identique octet par octet, une signature qualifiée ou une conformité PA. Un XML embarqué n’est pas une preuve de transmission.
- Une ancienne pièce sans autorité vérifiable peut rester non régénérable. Sa réconciliation exige une source indépendante fiable, pas une reconstruction opportuniste.

## Preuves exécutées

Environnement : Supabase jetable appartenant à cette revue, API locale `55321`, base locale `55322`, Worker HTTPS local `3411`, clés fournisseurs neutralisées. Le Supabase préexistant sur `54321` n’a pas été réinitialisé ni arrêté.

| Contrôle | Résultat observé |
|---|---|
| Installation du lockfile | `npm ci` effectué sous Node 24 |
| Typage et lint | `tsc --noEmit` et ESLint, zéro avertissement de lint |
| Tests unitaires et régressions natives | 492 tests, 37 fichiers, réussis, dont trois scénarios workerd réels |
| Isolation réelle Supabase | 65 tests, 7 fichiers, réussis |
| Fixtures SQL comportementales | 12 fixtures principales exécutées ; fixture cockpit 019 exécutée sur sa base séparée |
| Build de livraison | Next 16.4.3 puis bundle OpenNext Cloudflare produits avec succès |
| Dépendances | `npm audit` complet : zéro vulnérabilité signalée à la date de la revue |
| Inventaire logiciel | SBOM CycloneDX 1.5 généré depuis le lockfile, 1 214 composants |
| Secrets dans les sources courantes | Gitleaks sans constat dans `src`, `scripts`, `supabase`, `tests` et `.github` ; le scan historique reste distinct et non vert |
| Préflight/skill/scripts | 15 sondes locales ; 21 scénarios workflow avec commandes non déployantes ; 12 scénarios de cible effective ; actionlint réussi |

Les nombres de fixtures, tests et sondes ne sont pas un pourcentage de couverture de l’application. Les commandes simulées de déploiement prouvent leurs garde-fous, pas un déploiement Cloudflare ou un run GitHub hébergé.

### Parcours réels et contre-exemples

- Connexion, tableau de bord, facturation, préparation de contrat et vues de planning hydratées sur le Worker. Carte React-Leaflet 5 : marqueur, tuiles et changement de zoom exercés après création d’un arrêt de test valide.
- CSP de production : nonces distincts sur deux requêtes, nonce client ignoré, scripts inline cohérents avec le nonce de réponse, absence de `unsafe-inline`/`unsafe-eval` dans `script-src`. Les styles inline nécessaires à l’interface restent une politique distincte.
- Le code d’intégration proposé dans les réglages était inutilisable : l’iframe tierce était bloquée par `frame-ancestors 'none'`. L’exception est maintenant limitée à `/demande/[orgSlug]`, sans `X-Frame-Options` contradictoire. Le vrai navigateur affiche le formulaire dans une autre origine et avance de « Qui êtes-vous ? » à « Votre projet » ; authentification, PDF privés et sous-chemins non prévus conservent le refus CSP. Aucun envoi de demande n’a été nécessaire à cette preuve.
- Avant `213`, deux écritures concurrentes réelles produisaient deux paiements de 120 € pour un total de facture à 120 €. Après correction, deux RPC HTTP authentifiées ont produit un seul paiement, une seule transition effective et la même date de paiement. L’action dans l’interface a enregistré un seul paiement de 30 €. La fixture couvre aussi droits owner/viewer/foreign/anon, solde partiel, historique payé avec date nulle et rollback après insertion.
- Signature manuscrite au pointeur avec DPR 4 : contrat seul puis contrat + devis. Le consentement conjoint a produit `signed`/`accepted`, même instant en base et même signataire. Le PNG conservé fait 1 240 × 720 ; le PDF public signé répond 200, `no-store`, et embarque réellement son image de signature.
- Le contrat + devis précédemment refusé pour la représentation numérique a été utilisé après `214` avec le **même lien**, sans republication préalable. Le hash d’origine vérifiait la ligne persistée avant le consentement.
- Un devis chargé puis expiré côté serveur a refusé le consentement ; aucune signature n’a été persistée. Un formulaire chargé puis désactivé a refusé son envoi sans créer de demande.
- Après modification du nom, de l’assujettissement de l’entreprise et de l’acheteur, le PDF de facture conserve les parties originales et 100 € HT + 20 € de TVA = 120 € TTC. Le XML effectivement extrait du PDF est identique à celui extrait avant ces changements.
- Le DGD réel inclut une situation payée et une partiellement payée : 300 € HT. Les factures standard ne sont pas des situations DGD ; la fixture a été corrigée en conséquence avant de qualifier ce chemin.
- L’export mensuel réel omettait deux factures archivées : 370 € TTC encaissés au lieu des 610 € enregistrés. Après correction, le ZIP contient les sept factures et le rapport affiche 610 € TTC encaissés, dont 101,67 € de TVA, malgré le régime courant non assujetti. Ce rapport n’est pas une certification comptable ou réglementaire.
- Téléchargement privé : 200 pour l’organisation propriétaire, 404 pour un autre utilisateur authentifié ; octets et SHA-256 conservés. Une pièce migrée sans extension est servie en octet-stream forcé au téléchargement. L’upload public réel produit un chemin UUID privé, sans URL publique.
- CLI de réconciliation : quatre objets Storage réels déplacés, références multiples indépendantes conservées, source ancienne disparue et destination de même hash. Reprise sans recréation ; mauvaise propriété et suppression d’un objet d’organisation active refusées. Les inventaires et plans privés ne constituent pas une preuve de propriété à eux seuls.
- Deux connexions PostgreSQL réelles ont exercé les deux ordres des courses émission/lignes et revendication/activation d’identité : blocage observé sous verrou puis résultat métier attendu.
- Reprise réelle du cron d’effacement : organisation réutilisant l’ancien slug d’une autre organisation, fichier du propriétaire survivant inchangé, Auth supprimée et logo propre purgé. L’adoption d’un logo déjà revendiqué a été refusée pendant la fenêtre précédant sa suppression.
- Effacement final de l’organisation principale : ancien JWT encore valide refusé en écriture, upload canonique privilégié également refusé, aucun objet créé, anciens liens publics révoqués et Auth supprimée. Les sept snapshots fiscaux et les deux publications signées sont inchangés ; le fichier et le logo partagé de l’organisation survivante restent disponibles. La reprise du cron ne retraite aucun compte déjà terminé.
- Réseau PDF : une requête interne et une image incorporée étaient observées avant correction ; aucune requête vers cette source rejetée après correction. Cas légitimes, redirections, limites de flux et dimensions exercés ; préparation inline et signature dans le vrai Worker également exercées.
- Compatibilité native : `redirect: 'error'`, valide dans les tests Node, est refusé par workerd. Les trois consommateurs concernés utilisent désormais `manual` et rejettent les réponses non réussies sans suivre la redirection. Le DGD produit par le vrai Worker embarque à nouveau le PNG légitime de 1 061 × 1 500. Trois régressions permanentes exécutent workerd : image réellement incorporée au PDF, redirection sans requête vers l’origine piège et arrêt d’un flux surdimensionné sans `Content-Length`.
- Export complet d’organisation : la vraie requête d’équipe utilisait une relation memberships/profiles absente du schéma et produisait un CSV vide. Après réparation, le ZIP réel contient l’identifiant et l’email du membre attendu, sans erreur de lecture masquée. Sur serveur HTTPS local réel, l’ancien lecteur consommait les 64 Mio du producteur ; le lecteur borné interrompt la réponse aux environs de 10 Mio, conserve le logo légitime et ne suit pas la redirection. La limite concerne les octets accumulés, pas une promesse de mémoire totale du processus.

Le certificat HTTPS du preview est auto-signé : les exceptions de test ont été limitées au contexte local. Le chargeur d’icônes Next refuse les images loopback ; cette protection n’a pas été désactivée pour faire passer les essais. Les refus de certificat et les préfetchs interrompus du navigateur local ne sont pas présentés comme des défauts de production corrigés.

## Next.js et qualité d’exploitation

Versions retenues : **Node 24, Next 16.4.3, React 19.2.9, React-Leaflet 5, OpenNext Cloudflare 1.20.13, Wrangler 4.153.0**. SheetJS utilise la distribution officielle 0.20.3. Les API de dépendances affectées et le Worker ont été exercés, pas seulement leur installation.

Next 14 n’est pas conservé. Le choix de Next 16 tient aussi à la fenêtre de support : le tableau amont affiche encore Next 15 en maintenance, mais les deux ans publiés depuis sa sortie du 21 octobre 2024 ne laissent plus de marge au 27 octobre 2026. Le statut `npm audit` ne remplace pas ce contrôle de support. Références : [politique Next](https://nextjs.org/support-policy), [adaptateur OpenNext Cloudflare](https://opennext.js.org/cloudflare).

- Build/dev explicitement en Webpack ; configuration flat ESLint native de Next 16, sans double enregistrement des plugins.
- Convention Edge Middleware conservée : le Proxy/Middleware Node proposé par le codemod Next n’est pas pris en charge par l’adaptateur utilisé. La dépréciation n’est pas masquée.
- Avertissements conservés : convention Middleware, compatibilité workerd datée et mode de queue ISR direct. Les pages applicatives du build sont dynamiques ; aucun gain ou comportement ISR de production n’est déduit de ce build.
- Dépréciations transitives et politique npm de scripts d’installation restent à suivre. Aucun script fournisseur réel n’a été approuvé ou activé pour contourner les contrôles.
- Des chargements et copies de données inutiles ont été retirés des lecteurs documentaires ; les images sont bornées. **Aucun gain chiffré de vitesse ni dimensionnement de production n’est revendiqué.**

## Risques opérationnels encore ouverts

### 1. Historique public — traitement prioritaire

Le scan historique observé comporte **22 constats**, pas 22 secrets distincts :

- neuf occurrences `signature_token` dans trois fichiers de cache `.next` ; leur validité actuelle n’est pas établie ;
- matériel de chiffrement Server Actions dans deux manifests serveur ;
- onze JWT identifiés comme clés **anon publiques**, pas des `service_role`.

Le commit concerné observé est `0e0ddcf9fd931b9a8cdf5c51a1f0d645feba04d1`. Les valeurs ne sont pas reproduites ici. Il n’est pas établi que toutes les clés fournisseurs aient été divulguées ; l’ancienne recommandation de rotation indiscriminée est retirée.

Inventorier et invalider les capacités réellement exposées, renouveler le matériel concerné, puis traiter les artefacts historiques suivant une procédure coordonnée. Les trois exclusions Gitleaks exactes existantes couvrent des cas bénins explicitement revus ; aucune exclusion large ne rend artificiellement l’historique vert. Ne pas remplacer aveuglément la clé AES de credentials : les données concernées nécessitent un plan de rechiffrement.

L’index courant ne contient aucun fichier de `.next`, `.open-next` ou `node_modules`. Le seul constat sur `.env.client-template` a été identifié comme `NEXT_PUBLIC_POSTHOG_KEY`, clé analytique publique côté client, pas une credential serveur ; sa valeur n’est pas reproduite. Le scan distinct de `.env.example` est sans constat. Ces résultats ne blanchissent pas l’historique.

### 2. GitHub et configuration de livraison

Les métadonnées consultées indiquaient : dépôt public, `main` sans protection et environnement `Atelier CDF` sans reviewers ni politique de branche. Les secrets de configuration attendus `ATELIER_APP_ENV` et `COCKPIT_ENV` n’étaient pas présents parmi les noms retournés. Ces paramètres distants n’ont pas été modifiés.

Mettre en place les protections et configurations exactes avant de qualifier la livraison hébergée. Les actions épinglées, contrôles de SHA/événement et tests locaux du workflow ne prouvent pas ces protections distantes.

#### Suivi opérationnel du 30 octobre 2026

Après autorisation explicite, les quatre workflows de déploiement du dépôt `premiceslegacy-ship-it/kompagnon-project` ont été suspendus via l’API GitHub :

| Workflow | ID | État relu après mutation |
|---|---|---|
| Deploy — Tous les clients | 287694951 | `disabled_manually` |
| Deploy — Atelier App | 330729010 | `disabled_manually` |
| Deploy — Client Atelier | 287694953 | `disabled_manually` |
| Deploy — Cockpit Orsayn | 287694955 | `disabled_manually` |

Le workflow CI (`359609010`) reste `active`. Les requêtes Actions filtrées sur `in_progress` et `queued` n’ont retourné aucun run. Cette suspension ne coupe pas les applications déployées et ne bloque pas les déploiements manuels via CLI. Aucun déploiement, aucune rotation, aucune migration distante et aucune mutation Storage n’ont été exécutés dans ce suivi. Les quatre risques opérationnels restent ouverts ; la suspension n’est pas un feu vert de livraison.

### 3. Cutover des bases et actifs historiques

Avant publication : sauvegarde/reprise, vérification du projet distant exact, migrations principales jusqu’à 214 et cockpit 019, maintenance avec drainage des entrées et crons, inventaire privé puis réconciliation autorisée des anciennes pièces. Ne pas déduire le propriétaire d’un slug ou d’un UUID ancien. Le gate des pièces jointes ne remplace pas la vérification de toute la chaîne de migrations.

Les alias Storage personnalisés, sources historiques externes et configurations de chaque instance doivent être qualifiés sur leur cible. Aucun déplacement/suppression en production n’est attesté par les quatre objets locaux.

### 4. Fournisseurs et réglementation

Aucun nouveau test réel de livraison email, PA/Super PDP, Stripe, Sentry ou fournisseur IA payant n’a été exécuté. Les secrets ont été neutralisés pendant les essais locaux. Avant ouverture, exercer les scénarios sandbox requis, accusés, refus et réponses ambiguës, puis les configurations de production autorisées. Le succès de la signature locale ou la présence de Factur-X dans un PDF ne garantit pas une notification délivrée, une identité qualifiée ou une conformité fiscale générale.

## Revue du skill `backend-orsayn`

Le skill et ses références ont été révisés pour partir de la demande, du dépôt, des contraintes, des autorités de données et du mode d’intervention autorisé. Ils distinguent audit read-only, correction, implémentation, mesure et opérations sensibles ; ils exigent une preuve au vrai point d’effet, et non une fonction de validation simplement présente dans le code.

Les prescriptions universelles injustifiées ont été retirées ou contextualisées : pas de migration Next/Workers/Supabase imposée à un autre stack, de DAL obligatoire, de bannissement global de cache/client fetch/Sentry, de contournement RLS ou de budgets de performance inventés. Le validateur à mots-clés ne sert plus de preuve d’un raisonnement d’audit.

Quatre cas contrastés ont été revus pour vérifier cette adaptation : Django sur VM en lecture seule, site statique, correction cross-tenant Node/PostgreSQL, et problème de performance PDF. Ce contrôle de doctrine n’est pas l’exécution de quatre audits externes. Les patterns Atelier consignent les contre-exemples réels — états `viewed`, slug réutilisé, courses, I/O d’image, cible effective et précision JSON — sans en faire une recette universelle.

Le skill peut guider un audit et une implémentation sur mesure ; il ne certifie pas à lui seul les compétences d’un agent ni la sécurité d’un projet inconnu. Une future refonte UX/UI doit préserver les invariants prouvés de consentement, paiement, archivage, autorité historique et isolation.
