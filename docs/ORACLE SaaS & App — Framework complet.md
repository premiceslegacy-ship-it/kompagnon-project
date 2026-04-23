# **ORACLE SaaS & App — Framework complet**

## **Philosophie**

Un SaaS sans architecture solide, c'est de la dette technique dès le premier commit. La différence entre une app qui scale et une app qu'on réécrit en 6 mois, c'est la qualité de ce qui est pensé avant que la première ligne de code soit écrite.

Un SaaS construit sans les couches 1, 2 et 3, c'est construire un immeuble sans plan d'architecte.

---

## **Différences clés avec ORACLE Site Web**

Ce skill couvre des problèmes que les sites web n'ont pas :

* **Auth complète** — inscription, connexion, sessions, refresh tokens, MFA  
* **Modèle de données** — schéma BDD, relations, RLS, migrations  
* **Abonnements** — plans, limites, upgrades, webhooks Stripe  
* **Multi-tenant** — isolation des données par organisation/workspace  
* **Rôles et permissions** — admin, member, viewer, custom roles  
* **Onboarding** — activation, empty states, time-to-value  
* **Dashboard et data** — métriques, graphes, exports, états complexes  
* **Real-time** — notifications, mises à jour live, présence  
* **API et webhooks** — pour les intégrations tierces  
* **Rétention** — emails transactionnels, séquences, in-app notifications

---

## **Avant de commencer — Lire le projet**

Ces 5 dimensions calibrent tout : la stack, le modèle de données, les audits et la complexité du PRD.

**1\. Type d'app**

* SaaS B2B (outil professionnel, workspace, équipe) → multi-tenant, rôles, facturation par siège  
* SaaS B2C (outil personnel, abonnement individuel) → onboarding, activation, conversion freemium  
* App interne / back-office → auth simple, données denses, exports  
* Marketplace / plateforme → deux types d'utilisateurs, transactions  
* App mobile first → React Native ou PWA, offline mode, push notifs  
* Dashboard / analytics → graphes, temps réel, exports, filtres complexes

**2\. Modèle d'authentification**

* Email \+ mot de passe (toujours)  
* OAuth (Google / GitHub / Slack — identifier lesquels)  
* Magic link (sans mot de passe — B2C grand public)  
* SSO / SAML (Enterprise — Okta, Azure AD)  
* MFA (2FA TOTP — obligatoire si données sensibles)

**3\. Modèle économique**

* Freemium → limites de features ou de volume  
* Abonnement mensuel/annuel → plans Free / Pro / Business / Enterprise  
* Usage-based → facturation à la consommation (API calls, seats, storage)  
* One-shot → paiement unique, pas d'abonnement récurrent  
* Pas de monétisation (outil interne, MVP de validation)

**4\. Multi-tenancy**

* Single user → chaque compte est isolé, pas d'équipe  
* Team / workspace → plusieurs membres, un seul espace partagé  
* Multi-org → une personne peut appartenir à plusieurs organisations  
* Enterprise → organisations avec sous-comptes, SSO, audit logs

**5\. Intégrations nécessaires**

*  Auth (Supabase Auth / Clerk / NextAuth)  
*  BDD (Supabase Postgres / PlanetScale / Neon)  
*  Paiement (Stripe Subscriptions / Lemon Squeezy)  
*  Email transactionnel (Resend \+ React Email)  
*  Séquences d'onboarding (Resend / Customer.io / Loops)  
*  Analytics produit (PostHog / Mixpanel / Amplitude)  
*  Analytics web (Plausible / Vercel Analytics)  
*  Monitoring erreurs (Sentry)  
*  Real-time (Supabase Realtime / Pusher / Ably)  
*  Storage fichiers (Supabase Storage / Cloudflare R2 / S3)  
*  Recherche (Algolia / Typesense / pg\_search)  
*  Automatisations (Make / n8n / webhooks custom)  
*  Support (Intercom / Crisp / Linear pour le bug tracking)  
*  Emails marketing (Loops / Brevo / Customer.io)  
*  Feature flags (Unleash / PostHog flags / LaunchDarkly)

---

## **Couche 1 — Structuration avec l'Architecte Suprême**

Cette couche est gérée manuellement par le builder avant d'utiliser ce skill. Elle produit le **master prompt**chargé dans le Projet Claude ou Gem dédié.

Le Conseil d'Experts recommandé pour un SaaS :

**Stratégie produit**

* Product Strategist SaaS — positionnement, acquisition, activation, rétention (framework AARRR)  
* Growth Hacker — onboarding, time-to-value, email séquences, conversion freemium  
* Copywriter orienté conversion SaaS — pricing pages, onboarding copy, emails

**Design et expérience**

* Lead Product Designer UI — design system SaaS, composants dense, dashboard UX  
* UX Researcher — user flows complexes, onboarding friction, empty states  
* Accessibility Expert — WCAG 2.2 AA, navigation clavier sur app complexe

**Technique**

* Architecte Next.js senior — App Router, Server Actions, Server Components, patterns SaaS  
* Expert Supabase — schéma BDD, RLS, Auth, Realtime, Storage, migrations  
* Ingénieur sécurité — OWASP, RLS strict, rate limiting, validation, audit logs  
* Expert Stripe — subscriptions, webhooks, portail client, metered billing  
* Expert performance — Core Web Vitals sur dashboard dense, lazy loading, pagination

**Produit**

* Expert onboarding SaaS — activation, empty states, first value moment, checklists  
* Expert rétention — emails transactionnels, in-app notifications, feature discovery

---

## **Couche 2 — Les 7 documents fondateurs**

L'ordre est inviolable. Les documents 2 et 3 sont délégués au skill `ux-ui-design`.

BRIEF.md → \[ux-ui-design\] BRAND-SYSTEM.md → \[ux-ui-design\] DESIGN-SYSTEM.md  
→ DATA-MODEL.md → PRD.md → USER-FLOWS.md → PROMPT-SYSTEM.md

**Documents 2 & 3 — délégués à `ux-ui-design`** Active ce skill avec le BRIEF.md et demande-lui de produire BRAND-SYSTEM.md puis DESIGN-SYSTEM.md. Reviens ici avec les deux fichiers validés.

---

### **Document 1 — BRIEF.md**

**Rôle :** la carte d'identité complète du produit. Capture le problème réel, l'utilisateur exact, le modèle économique et les contraintes avant toute décision technique.

**Prompt de production :**

Produis le BRIEF.md complet pour \[nom du produit\].

1\. LE PRODUIT  
   Nom et concept en une phrase.  
   Le problème réel résolu (la douleur concrète, pas "manque d'outil").  
   Ce que l'utilisateur fait aujourd'hui pour résoudre ce problème et pourquoi c'est insuffisant.  
   La solution — ce que le produit fait précisément, pas comment il le fait.  
   Ce que ce produit n'est PAS (frontières claires).

2\. LE BUILDER  
   Qui construit : solo / équipe / agence.  
   Niveau technique disponible.  
   Budget et délai réalistes.  
   Objectif post-lancement (MRR cible, nombre d'utilisateurs, validation d'hypothèse).

3\. L'UTILISATEUR PRINCIPAL  
   Profil précis : titre, taille d'entreprise, outil qu'il utilise aujourd'hui.  
   Contexte d'usage exact : quand, où, dans quel flux de travail.  
   Ce qu'il veut accomplir — la tâche de fond (Jobs To Be Done).  
   Ses freins à l'adoption d'un nouvel outil.  
   Ce qui le ferait abandonner le produit après 7 jours.

4\. LE MODÈLE ÉCONOMIQUE  
   Type : freemium / abonnement / usage-based / one-shot / interne.  
   Plans envisagés (noms, prix indicatifs, limites par plan).  
   Ce qui est gratuit et pourquoi.  
   Ce qui est payant et pourquoi c'est la limite naturelle.  
   Metric d'expansion revenue si applicable (seats, usage, features).

5\. LA CONCURRENCE  
   3 concurrents directs avec leur force principale et leur faiblesse principale.  
   Pourquoi l'utilisateur choisirait ce produit plutôt que chacun d'eux.  
   Positionnement unique : ce qu'on fait mieux, pour qui, pourquoi ça compte.

6\. LES CONTRAINTES  
   Stack : imposée ou à choisir.  
   Auth : méthodes requises (email, OAuth, SSO).  
   Multi-tenancy : single user / team / multi-org.  
   Données sensibles : RGPD, chiffrement, résidence des données.  
   Intégrations bloquantes (sans lesquelles le produit ne peut pas être lancé).

7\. LES MÉTRIQUES DE SUCCÈS  
   À 30 jours : acquisition et activation (signups, onboarding completion, first action).  
   À 90 jours : rétention et conversion (DAU/WAU, churn, MRR).  
   Indicateur North Star (la métrique qui prouve que le produit crée de la valeur).

8\. LES RISQUES  
   Risques produit : hypothèses non validées, features non prioritaires.  
   Risques techniques : intégrations complexes, scalabilité.  
   Risques business : acquisition, conversion, churn.  
   Comment on mitige chacun.  
---

### **Document 2 & 3 — BRAND-SYSTEM.md \+ DESIGN-SYSTEM.md**

**Délégués au skill `ux-ui-design`.** Fournir le BRIEF.md. Le skill produit les deux documents dans l'ordre. Note pour le SaaS : demander explicitement à `ux-ui-design` de traiter les spécificités SaaS — états vides, skeletons, navigation app, sidebar, density des données dans les dashboards.

---

### **Document 4 — DATA-MODEL.md**

**Rôle :** le schéma de la base de données et les règles de sécurité. Document critique et spécifique au SaaS — inexistant dans ORACLE Site Web. Sans lui, l'IA génère une BDD incohérente.

**Prompt de production :**

Produis le DATA-MODEL.md complet pour \[nom du produit\].  
Stack BDD : Supabase (Postgres \+ RLS \+ Auth).

\--- SECTION 1 : ENTITÉS PRINCIPALES \---

Pour chaque table :  
\- Nom (snake\_case)  
\- Colonnes avec types Postgres précis  
\- Clés primaires et étrangères  
\- Contraintes (unique, not null, check)  
\- Index recommandés (pour les requêtes fréquentes)

Tables standard à inclure selon le projet :  
profiles         (extension de auth.users — données publiques de l'utilisateur)  
organizations    (si multi-tenant — workspace/équipe)  
memberships      (relation user ↔ organization avec role)  
subscriptions    (plans, statuts, stripe\_customer\_id, stripe\_subscription\_id)  
\[tables métier spécifiques au produit\]

\--- SECTION 2 : ROW LEVEL SECURITY (RLS) \---

Pour chaque table, documenter les politiques RLS :

SELECT : qui peut lire quelles lignes ?  
INSERT : qui peut créer ? Avec quelles valeurs forcées ?  
UPDATE : qui peut modifier quelles colonnes ?  
DELETE : qui peut supprimer ?

Règles standard SaaS :  
Un utilisateur ne voit que ses propres données.  
Un membre voit les données de son organisation.  
Un admin peut tout voir dans son organisation.  
Jamais de données cross-tenant.

Politique type à documenter pour chaque table :  
CREATE POLICY "nom\_explicite" ON table\_name  
  FOR \[SELECT|INSERT|UPDATE|DELETE\]  
  TO authenticated  
  USING (\[condition RLS\]);

\--- SECTION 3 : RELATIONS ET INTÉGRITÉ \---

Diagramme textuel des relations entre tables.  
Cascades : que se passe-t-il en cas de suppression d'un utilisateur ?  
  → suppression en cascade, soft delete ou erreur ?  
Données orphelines : lesquelles sont acceptables ? Lesquelles pas ?

\--- SECTION 4 : DONNÉES SENSIBLES \---

Colonnes à ne jamais exposer côté client.  
Colonnes à chiffrer (si applicable).  
Colonnes soumises au RGPD (à anonymiser lors d'une suppression de compte).  
PII (Personally Identifiable Information) identifiée.

\--- SECTION 5 : FONCTIONS ET TRIGGERS \---

Triggers Postgres nécessaires :  
\- Création automatique d'un profil à l'inscription  
\- Mise à jour automatique de updated\_at  
\- Audit log sur les actions sensibles

Fonctions RPC Supabase utiles pour ce projet.

\--- SECTION 6 : MIGRATIONS \---

Ordre de création des tables (respecter les dépendances de clés étrangères).  
Données de seed pour le développement.  
Données de seed pour les tests.  
---

### **Document 5 — PRD.md**

**Rôle :** le document de référence produit complet. Spécifique SaaS — couvre les plans, les limites, l'onboarding, les emails transactionnels.

**Prompt de production :**

Produis le PRD.md complet pour \[nom du produit\].  
Utilise BRIEF.md et DATA-MODEL.md comme sources de vérité.

\--- SECTION 1 : VISION PRODUIT \---

Vision en 2 phrases.  
Principe directeur : la décision qui guide tous les trade-offs.  
KPIs mesurables (pas qualitatifs).  
Hors scope V1 : ce que ce PRD ne couvre pas.

\--- SECTION 2 : UTILISATEURS ET RÔLES \---

Pour chaque rôle (Owner, Admin, Member, Viewer, etc.) :  
\- Ce qu'il peut faire  
\- Ce qu'il ne peut pas faire  
\- Comment il arrive dans le système (invitation, inscription directe, SSO)

\--- SECTION 3 : PLANS ET LIMITES \---

Pour chaque plan :  
Nom, prix, destinataire cible.  
Limites précises (volume, features, seats, storage).  
Ce qui se passe quand la limite est atteinte (blocage, upgrade prompt, grace period).  
Ce qui est inclus uniquement dans les plans supérieurs et pourquoi.

Règle : les limites doivent être codées comme des constantes dans /lib/plans.ts  
jamais hardcodées dans les composants.

\--- SECTION 4 : ARCHITECTURE DE L'APP \---

Toutes les routes de l'application avec leur rôle exact.  
Séparation nette :  
  Routes publiques (marketing, pricing, auth)  
  Routes app authentifiées (/app/\[...\])  
  Routes admin (/admin/\[...\] — si applicable)  
  Routes API (/api/\[...\])

Pour chaque route/page :  
\- L'objectif unique  
\- Le contenu dans l'ordre vertical  
\- Critères d'acceptation binaires

\--- SECTION 5 : FONCTIONNALITÉS P1/P2/P3 \---

P1 — Bloque le lancement.  
Pour chaque feature P1 :  
Description précise du comportement attendu.  
Critère d'acceptation binaire.  
Cas d'erreur à gérer impérativement.  
Impact sur le schéma BDD.  
Dépendances (autres features, intégrations).

P2 — Dans les 60 jours post-lancement.  
P3 — Roadmap future — jamais pendant le sprint V1.

\--- SECTION 6 : ONBOARDING ET ACTIVATION \---

L'onboarding est la feature la plus importante d'un SaaS.  
Un utilisateur qui n'active pas dans les 7 jours ne reviendra pas.

Définir :  
Le "first value moment" (l'instant précis où l'utilisateur comprend la valeur).  
Les étapes obligatoires pour y arriver (maximum 3-5 étapes).  
Ce qui se passe si l'utilisateur abandonne à chaque étape.  
Les emails déclenchés à J+1 / J+3 / J+7 si non activé.  
La checklist d'onboarding in-app (si applicable).

\--- SECTION 7 : EMAILS TRANSACTIONNELS \---

Liste exhaustive de tous les emails envoyés par le produit :  
Déclencheur précis → Sujet → Contenu attendu → Timing

Emails standard SaaS :  
Confirmation d'inscription \+ magic link ou lien de vérification  
Email de bienvenue (post-vérification)  
Invitation à rejoindre une organisation  
Réinitialisation de mot de passe  
Confirmation de paiement  
Échec de paiement (J0 \+ J3 \+ J7)  
Fin de période d'essai (J-7 \+ J-3 \+ J0)  
Annulation de l'abonnement (confirmation \+ offre de rétention)  
Upgrade/downgrade de plan  
Suppression de compte

\--- SECTION 8 : INTÉGRATIONS ET APIS \---

Pour chaque intégration :  
Outil et version.  
Flow nominal complet.  
Flow d'erreur et fallback.  
Webhooks à gérer (surtout Stripe — documenter chaque event).  
Clés dans variables d'environnement Vercel — jamais dans le code.

Stripe spécifiquement :  
checkout.session.completed  
customer.subscription.updated  
customer.subscription.deleted  
invoice.payment\_succeeded  
invoice.payment\_failed

\--- SECTION 9 : CONTRAINTES TECHNIQUES \---

Stack complète avec versions.  
Performance : LCP \< 2.5s · INP \< 200ms · CLS \< 0.1  
Breakpoints : 375px · 768px · 1024px · 1440px  
Accessibilité : WCAG 2.2 AA  
Limites Supabase à respecter (RLS sur toutes les tables, pas de service\_role côté client)

\--- SECTION 10 : MÉTRIQUES DE SUCCÈS \---

À 30 jours :  
Taux d'activation (% qui atteignent le first value moment)  
Conversion trial-to-paid (si applicable)  
Taux de complétion de l'onboarding

À 90 jours :  
DAU / WAU / MAU  
Churn mensuel (\< 5% \= sain pour un SaaS B2B)  
MRR et croissance MRR  
NPS ou CSAT  
---

### **Document 6 — USER-FLOWS.md**

**Rôle :** la cartographie complète de tous les parcours utilisateurs dans l'app. Spécifique SaaS — couvre les flows d'auth, d'onboarding, de billing, et les états des features.

**Prompt de production :**

Produis le USER-FLOWS.md complet pour \[nom du produit\].

\--- SECTION 1 : FLOWS D'AUTH \---

INSCRIPTION  
Chaque étape dans l'ordre (form → validation → email → vérification → onboarding).  
Cas d'erreur à chaque étape (email déjà utilisé, lien expiré, etc.).  
Comportement si l'utilisateur ferme la fenêtre en cours de route.

CONNEXION  
Email \+ mot de passe : flux nominal \+ erreurs (mauvais mdp, compte bloqué).  
OAuth (Google / GitHub) : flux nominal \+ erreurs (permissions refusées, compte déjà lié).  
Magic link : flux nominal \+ lien expiré \+ lien déjà utilisé.  
MFA : flux nominal \+ code invalide \+ perte d'accès.

MOT DE PASSE OUBLIÉ  
Chaque étape avec timing des emails et expiration des tokens.

DÉCONNEXION  
Simple \+ déconnexion de tous les appareils.

\--- SECTION 2 : FLOW D'ONBOARDING \---

Cartographier le chemin de la première connexion au first value moment.  
Pour chaque étape :  
Écran affiché.  
Ce que l'utilisateur doit faire.  
Ce qui se passe s'il passe sans faire l'action.  
Ce qui se passe s'il fait une erreur.  
Email ou notification déclenchée.

\--- SECTION 3 : FLOWS MÉTIER PRINCIPAUX \---

Pour chaque action clé du produit (créer, éditer, supprimer une entité principale) :  
Point d'entrée.  
Chaque écran dans l'ordre.  
Bifurcations (oui/non avec les deux chemins).  
Cas d'erreur et récupération.  
Confirmation et feedback.

\--- SECTION 4 : FLOWS DE BILLING \---

UPGRADE  
Comment l'utilisateur découvre qu'il a besoin d'upgrader (atteinte d'une limite).  
Le prompt d'upgrade : où, quand, avec quel message.  
Flow Stripe Checkout → success → activation des features payantes.  
Flow d'erreur de paiement.

DOWNGRADE  
Comment l'utilisateur change de plan.  
Ce qui se passe aux données excédentaires (archivage, suppression, conservation temporaire).  
Email de confirmation.

ANNULATION  
Flow de rétention (offre de pause, downgrade suggestion).  
Confirmation d'annulation \+ email.  
Comportement de l'app après annulation (accès jusqu'à la fin de la période payée).

\--- SECTION 5 : LES 4 ÉTATS — RÈGLE ABSOLUE \---

Tout composant gérant de la donnée doit avoir ces 4 états :

LOADING  
Skeleton avec shimmer (jamais page blanche).  
Préserver le layout pour éviter le content shift.

EMPTY  
Le premier empty state est le plus important du SaaS.  
Message humain qui explique POURQUOI c'est vide \+ CTA vers la première action.  
L'utilisateur doit comprendre quoi faire en moins de 3 secondes.  
Exemple : "Vous n'avez pas encore de projet. Créez votre premier projet en 30 secondes."

ERROR  
Message humain (jamais code d'erreur).  
Action de récupération claire.  
Option de contact support si l'erreur persiste.

LOADED  
Transition douce depuis le skeleton.  
Pagination ou infinite scroll pour les listes longues.  
Filtres et recherche si \> 10 items attendus.

\--- SECTION 6 : PERMISSIONS ET GARDE-FOUS \---

Pour chaque action sensible, documenter :  
Qui peut la faire (rôle requis).  
Ce qui s'affiche aux utilisateurs sans permission (hidden vs disabled vs redirect).  
Message d'erreur si tentative non autorisée.  
---

### **Document 7 — PROMPT-SYSTEM.md**

**Rôle :** le cerveau de l'IDE pour ce SaaS. Chargé dans /docs, lu par Claude Code à chaque session. Doit être entièrement autonome — Claude Code sait tout sans réexplication.

**Prompt de production :**

Produis le PROMPT-SYSTEM.md pour ce SaaS.  
Ce fichier est chargé dans /docs et lu par Claude Code à chaque session.  
Il doit être AUTONOME — Claude Code ne doit jamais demander de contexte.

1\. IDENTITÉ ET RÔLE  
   Expert SaaS sur \[nom du produit\].  
   Ce qu'il fait / ce qu'il ne fait jamais.  
   Niveau d'autonomie : quand il propose vs quand il exécute.

2\. CONTEXTE PRODUIT (5 lignes max)  
   Problème résolu, utilisateur cible, modèle économique, north star metric.

3\. STACK COMPLÈTE  
   Framework \+ version \+ dépendances clés.  
   Auth : provider \+ stratégie de session.  
   BDD : Supabase project URL (nom uniquement — jamais les clés).  
   Conventions : PascalCase composants · camelCase fonctions · kebab-case fichiers.  
   Variables d'environnement utilisées (noms uniquement).

4\. ARCHITECTURE DU PROJET  
   /app/(marketing)/    routes publiques  
   /app/(auth)/         connexion, inscription, réinitialisation  
   /app/(app)/          app authentifiée (protégée par middleware)  
   /app/(admin)/        admin (protégé par role check)  
   /app/api/            routes API et webhooks  
   /components/ui/      composants shadcn/ui  
   /components/app/     composants métier de l'app  
   /lib/                toute la logique métier, appels BDD, helpers  
   /lib/supabase/       client, server, middleware, types  
   /lib/stripe/         helpers Stripe, plans, webhooks  
   /lib/validations/    tous les schémas Zod  
   /lib/plans.ts        constantes de plans et limites  
   /data/               données statiques JSON  
   /docs/               documentation du projet  
   Règle absolue : zéro appel BDD dans les composants React.  
   Règle absolue : toute la logique dans /lib/.

5\. MODÈLE DE DONNÉES (résumé)  
   Tables principales avec leurs colonnes clés.  
   RLS activé sur toutes les tables.  
   Types TypeScript générés par Supabase CLI.

6\. DESIGN SYSTEM EN TOKENS  
   Couleurs (variables CSS \+ hex \+ rôle).  
   Typographies (classes Tailwind).  
   Espacements (valeurs autorisées).  
   Composants clés et leurs états.

7\. BRAND SYSTEM EN VOIX  
   Archétype et implication sur le copywriting.  
   Vocabulaire autorisé / interdit.  
   Ton de la microcopy (erreurs, succès, empty states).

8\. PLANS ET LIMITES  
   Constantes de /lib/plans.ts.  
   Comment vérifier le plan d'un utilisateur.  
   Comment afficher les prompts d'upgrade.

9\. PRINCIPES INVIOLABLES (numérotés par priorité)  
   Sécurité : RLS sur toutes les tables · Zod sur tous les inputs · rate limiting · jamais service\_role côté client  
   Performance : Server Components · lazy loading · pagination  
   Accessibilité : WCAG 2.2 AA · focus visible · aria-labels  
   Les 4 états sur tout composant data  
   Composant Image Next.js — jamais img brut  
   Mobile first absolu  
   \[Principes spécifiques au produit\]

10\. INTERDITS ABSOLUS  
    Ce que Claude Code ne fait JAMAIS sur ce projet.  
---

## **Couche 3 — Décisions structurantes \+ maquettes**

### **Temps 1 — Décisions avant le code**

Ces décisions bloquent si elles sont prises en cours de route. 30 minutes ici \= des semaines de refactoring évitées.

DÉCISION — AUTH STRATEGY  
Provider choisi : Supabase Auth / Clerk / NextAuth.  
Sessions : JWT ou cookies httpOnly ?  
Middleware Next.js : comment protéger les routes /app/\* ?  
Refresh token strategy ?  
OAuth providers à configurer (Google, GitHub, Slack).  
MFA : TOTP — quand l'activer (optionnel ou forcé) ?

DÉCISION — MULTI-TENANCY  
Model : single-user / team / multi-org.  
Comment l'organization\_id est-il propagé dans toutes les requêtes ?  
RLS : toutes les tables ont-elles une colonne organization\_id ou user\_id ?  
Invitation à une organisation : flow complet (email → lien → acceptation).

DÉCISION — STRIPE SUBSCRIPTIONS  
Créer le customer Stripe à l'inscription ou au premier checkout ?  
Plans : créer les Price IDs dans Stripe Dashboard avant le code.  
Webhook endpoint : /api/webhooks/stripe — comment valider la signature ?  
Portail client : Stripe Customer Portal pour gérer les abonnements ?  
Trial : durée, carte de crédit requise ou non ?

DÉCISION — LIMITES DE PLANS  
Où stocker les limites : /lib/plans.ts (objet constant par plan).  
Comment les vérifier : helper checkLimit(user, feature) dans /lib/limits.ts.  
Comment bloquer : composant \<PlanGate feature="x"\> qui affiche upgrade prompt.  
Comment mesurer l'usage : colonne de comptage en BDD ou query count() ?

DÉCISION — DONNÉES MODIFIABLES  
Données statiques dans /data/\*.json (pricing affiché, features marketing).  
Données configurables par l'admin dans la BDD (settings par organisation).  
Contenu modifiable sans code : spécifier quelles tables et par qui.

DÉCISION — REAL-TIME (si applicable)  
Quels events nécessitent du real-time vs polling.  
Supabase Realtime : subscriptions sur quelles tables/colonnes ?  
Optimistic updates : où les appliquer pour une UX instantanée ?

DÉCISION — ARCHITECTURE SEO (routes marketing)  
Les routes (marketing) sont statiques et indexables.  
Les routes (app) ne sont PAS indexées (noindex dans metadata).  
robots.txt : bloquer /app/\* et /admin/\*.

### **Temps 2 — Maquettes visuelles**

**Délégué au skill `ux-ui-design`.** Fournir BRAND-SYSTEM.md \+ DESIGN-SYSTEM.md \+ architecture de l'app du PRD.

Demander spécifiquement pour un SaaS :

* Dashboard principal avec sidebar navigation  
* Empty states des vues principales  
* Onboarding (étapes, progress)  
* Pricing page  
* Écran de connexion et d'inscription  
* Prompt d'upgrade (modal ou inline)  
* Version mobile des vues critiques

---

## **Couche 4 — Exécution dans l'IDE**

### **Initialisation**

1\. Créer le repo et connecter à Vercel  
2\. Initialiser Supabase project (staging \+ production séparés)  
3\. Créer /docs → PROMPT-SYSTEM.md · DATA-MODEL.md · skill-security.md · skill-architecture.md  
4\. Configurer les variables d'environnement dans Vercel  
5\. Générer les types TypeScript depuis Supabase CLI : supabase gen types typescript  
6\. Créer les migrations SQL dans /supabase/migrations/

### **Premier message Claude Code**

Charge et lis /docs/PROMPT-SYSTEM.md entièrement avant de produire quoi que ce soit.  
Confirme que tu as bien compris le produit, la stack, le schéma BDD,  
les principes de sécurité et les principes inviolables.  
Ensuite on commence par : \[première tâche précise\].

### **Ordre de construction — P1 complet avant tout P2**

Session 1 — Fondations  
  Migrations SQL dans /supabase/migrations/ (toutes les tables \+ RLS)  
  Types TypeScript générés (supabase gen types)  
  Clients Supabase : /lib/supabase/client.ts · server.ts · middleware.ts  
  /lib/plans.ts : constantes de plans et limites  
  Tokens Tailwind : couleurs, typos, espacements du DESIGN-SYSTEM  
  Layout global : structure avec sidebar ou top nav selon le PRD

Session 2 — Auth complète  
  Pages d'inscription, connexion, réinitialisation de mot de passe  
  OAuth si applicable  
  Middleware : protection des routes /app/\* et /admin/\*  
  Création automatique du profil à l'inscription (trigger Supabase)  
  Emails transactionnels auth : vérification, bienvenue, réinitialisation

Session 3 — Onboarding  
  Flow d'onboarding étape par étape  
  Empty states des vues principales (le plus important du SaaS)  
  Checklist d'activation si applicable  
  Email J+1 si non activé (Resend)

Session 4 — Features P1  
  Chaque feature dans l'ordre de priorité du PRD  
  Les 4 états sur chaque composant data  
  Limites de plans vérifiées sur chaque feature limitée  
  Prompts d'upgrade aux bons endroits

Session 5 — Billing  
  Stripe Checkout : création de session côté serveur  
  Webhook /api/webhooks/stripe : tous les events documentés dans le PRD  
  Portail client Stripe  
  Pages : /pricing · /billing · /upgrade  
  Gating des features selon le plan actif

Session 6 — Finitions et optimisation  
  Emails transactionnels restants (billing, offboarding)  
  Performance : Server Components, lazy loading, pagination  
  Accessibilité : focus, aria, navigation clavier  
  Tests responsive : 375px / 768px / 1024px / 1440px  
  RGPD : suppression de compte, export de données  
  Pages légales : CGU, politique de confidentialité, mentions légales

**Règles de construction non-négociables :**

* Une feature à 100% avant la suivante  
* RLS vérifié sur chaque nouvelle table avant de coder la feature qui l'utilise  
* Zod sur tous les inputs de toutes les routes API  
* Les 4 états sur tout composant data ou formulaire  
* Zéro appel BDD dans les composants React — passe par /lib/  
* Limites de plans vérifiées côté serveur — jamais uniquement côté client  
* `<Image>` Next.js obligatoire — jamais `<img>` brut

---

## **Couche 5 — Quatre audits de validation**

**Un CRITIQUE bloque la livraison. Toujours. Sans exception.**

### **Audit 1 — Fonctionnel et produit**

Tu es un auditeur produit senior.  
Voici le PRD : \[coller PRD.md\]  
Voici l'URL de preview : \[URL\]

CRITIQUE :  
Tous les critères d'acceptation P1 remplis ?  
L'onboarding mène au first value moment en \< 5 minutes ?  
Les 4 états couverts sur tous les composants data ?  
Le billing est-il fonctionnel en mode test Stripe ?  
Les limites de plans sont-elles respectées en production ?  
Responsive correct sur 375px, 768px, 1440px ?

IMPORTANT :  
Les emails transactionnels P1 s'envoient correctement ?  
Les empty states sont humains et ont des CTA ?  
Les prompts d'upgrade s'affichent aux bons endroits ?  
La suppression de compte fonctionne ?

MINEUR :  
404 personnalisée ?  
Favicon et Open Graph ?  
Pages légales complètes ?

Classe chaque écart : CRITIQUE / IMPORTANT / MINEUR \+ correctif exact.

### **Audit 2 — Sécurité SaaS**

Tu es un ingénieur sécurité senior spécialisé SaaS.  
Charge /docs/skill-security.md puis audite ce projet.

RLS — CRITIQUE :  
Toutes les tables ont-elles RLS activé ?  
Aucun accès cross-tenant possible (tester avec deux comptes différents) ?  
Le service\_role key n'est-il jamais utilisé côté client ?  
Les politiques RLS couvrent SELECT, INSERT, UPDATE et DELETE ?

AUTH — CRITIQUE :  
Les routes /app/\* sont-elles protégées par le middleware ?  
Les tokens JWT sont-ils validés côté serveur sur chaque route API ?  
Le refresh token est-il géré correctement ?  
Les magic links / liens de vérification expirent-ils ?

INPUTS — CRITIQUE :  
Validation Zod sur toutes les routes API ?  
Rate limiting sur les routes d'auth (login, register, reset) ?  
Rate limiting sur toutes les routes API publiques ?  
Pas de SQL injection possible (Supabase parameterized queries — vérifié) ?

STRIPE — CRITIQUE :  
La signature des webhooks Stripe est-elle vérifiée ?  
Aucune manipulation des prix côté client (le montant vient du serveur) ?  
Les plans actifs sont-ils lus depuis la BDD / Stripe, pas depuis le localStorage ?

DONNÉES — IMPORTANT :  
Les données sensibles ne sont pas exposées dans les réponses API ?  
Les emails ne sont pas visibles dans le HTML source ?  
Les clés API sont dans les variables d'environnement ?  
Honeypot sur les formulaires publics ?

Security headers dans next.config.js :  
X-Frame-Options · X-Content-Type-Options · Referrer-Policy · CSP

Chaque problème : CRITIQUE / IMPORTANT / MINEUR \+ correctif exact.

### **Audit 3 — Architecture**

Tu es un architecte logiciel senior.  
Charge /docs/skill-architecture.md puis audite ce projet.

1\. Des appels Supabase dans des composants React (hors /lib/) ?  
2\. Des limites de plans vérifiées uniquement côté client ?  
3\. Des balises img au lieu du composant Image Next.js ?  
4\. Les 4 états sur tous les composants data ?  
5\. Des fichiers \> 200 lignes ?  
6\. Des types any dans le TypeScript ?  
7\. Des constantes de plans hardcodées dans les composants (pas dans /lib/plans.ts) ?  
8\. De la logique métier dupliquée entre fichiers ?  
9\. Des variables d'environnement exposées côté client (NEXT\_PUBLIC\_ sur des secrets) ?

Rapport en deux parties :  
1\. Dette haute : corriger avant la livraison  
2\. Dette moyenne : documenter en P1 V2

### **Audit 4 — Rétention et activation**

Tu es un expert growth SaaS.  
Voici le PRD (section onboarding et emails) et accès à l'app.

ACTIVATION :  
Le first value moment est-il atteignable en \< 5 minutes par un nouvel utilisateur ?  
Les empty states guident-ils vers la première action ?  
L'onboarding peut-il être complété sans aide extérieure ?

RÉTENTION :  
Les emails J+1 / J+3 / J+7 sont-ils configurés ?  
L'email de fin de trial (J-7 / J-3 / J0) est-il configuré ?  
L'email de récupération après échec de paiement (J0 / J+3 / J+7) est-il configuré ?  
Y a-t-il un mécanisme de détection de churns potentiels ?

CONVERSION :  
Les prompts d'upgrade s'affichent-ils au bon moment (au moment de la friction) ?  
Le message d'upgrade est-il axé bénéfice et non feature ?  
La page pricing est-elle claire sur ce qui est inclus dans chaque plan ?

Rapport : CRITIQUE / IMPORTANT / MINEUR \+ recommandation.  
---

## **Stack de référence SaaS**

Framework        Next.js 14 App Router  
Styling          Tailwind CSS \+ shadcn/ui  
Auth             Supabase Auth (ou Clerk pour des besoins avancés)  
BDD              Supabase (Postgres \+ RLS \+ Realtime \+ Storage)  
Types            Supabase CLI gen types  
Déploiement      Vercel  
Paiement         Stripe (Subscriptions \+ Customer Portal \+ Webhooks)  
Email            Resend \+ React Email  
Séquences        Loops (ou Resend avec séquences)  
Analytics        PostHog (product analytics \+ feature flags)  
Analytics web    Plausible ou Vercel Analytics  
Monitoring       Sentry  
Icônes           Lucide React  
Images           next/image  
Validation       Zod (tous les inputs, côté serveur uniquement)  
State            Zustand (si état global complexe) ou React state simple  
Données          /data/\*.json pour le statique · Supabase pour le dynamique  
---

## **Checklist de livraison SaaS**

PRODUIT ET FONCTIONNEL  
\[ \] Tous les critères d'acceptation P1 du PRD remplis  
\[ \] Onboarding testé avec un compte vierge → first value moment atteint  
\[ \] Les 4 états sur tous les composants data et formulaires  
\[ \] Toutes les limites de plans fonctionnelles  
\[ \] Prompts d'upgrade aux bons endroits avec message bénéfice  
\[ \] Responsive testé : 375px / 768px / 1024px / 1440px  
\[ \] Navigation clavier fonctionnelle (Tab, Enter, Échap)  
\[ \] 404 personnalisée

SÉCURITÉ  
\[ \] RLS activé et testé sur toutes les tables (test cross-tenant)  
\[ \] Zod sur toutes les routes API  
\[ \] Rate limiting sur les routes d'auth et API publiques  
\[ \] Signature Stripe webhook vérifiée  
\[ \] Aucun service\_role côté client  
\[ \] Security headers dans next.config.js  
\[ \] Variables d'environnement correctement séparées (NEXT\_PUBLIC\_ uniquement pour le public)  
\[ \] Aucune clé dans le code ou le repo

BILLING  
\[ \] Stripe Checkout testé en mode test (success \+ cancel)  
\[ \] Webhooks testés : subscription created / updated / deleted / payment failed  
\[ \] Portail client Stripe fonctionnel  
\[ \] Downgrade testé (comportement aux données excédentaires conforme au PRD)  
\[ \] Annulation testée (accès jusqu'à fin de période payée)

EMAILS TRANSACTIONNELS  
\[ \] Vérification email (inscription)  
\[ \] Email de bienvenue  
\[ \] Réinitialisation de mot de passe  
\[ \] Invitation organisation (si multi-tenant)  
\[ \] Confirmation de paiement  
\[ \] Échec de paiement (J0 \+ J+3 \+ J+7)  
\[ \] Fin de trial (J-7 \+ J-3 \+ J0)  
\[ \] Annulation confirmée  
\[ \] Séquence onboarding (J+1 / J+3 / J+7 si non activé)

RGPD ET LÉGAL  
\[ \] Suppression de compte (données utilisateur anonymisées ou supprimées)  
\[ \] Export de données utilisateur (si applicable)  
\[ \] Politique de confidentialité complète  
\[ \] CGU complètes  
\[ \] Consentement cookies si analytics côté client

PERFORMANCE ET MONITORING  
\[ \] LCP \< 2.5s sur mobile  
\[ \] CLS \< 0.1  
\[ \] Sentry configuré (erreurs en temps réel)  
\[ \] PostHog configuré (events d'activation et rétention trackés)  
\[ \] Alertes Sentry configurées sur les erreurs critiques

MISE EN LIGNE  
\[ \] Domaine connecté dans Vercel  
\[ \] Variables d'environnement production configurées  
\[ \] Supabase project en mode production (pas staging)  
\[ \] Stripe en mode live (pas test)  
\[ \] DNS et SSL actifs  
---

## **Ce que ce skill ne couvre pas**

* **Marketplace** (deux types d'utilisateurs, transactions entre eux, split de revenus) → skill à venir  
* **App mobile React Native** → skill à venir  
* **API publique avec clés d'API tierces** (type OpenAI, Stripe pour les devs) → skill à venir

