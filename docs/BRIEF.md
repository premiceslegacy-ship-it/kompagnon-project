# BRIEF.md — Métier OS
### La plateforme ERP/CRM sectorielle pour les entreprises de métier manuel

---

## 1. LE PRODUIT

**Nom :** Métier OS *(working title — "Operating System for Craft Businesses")*

**Concept en une phrase :**
Métier OS est une plateforme ERP/CRM B2B capable de générer en quelques heures un outil de gestion complet, personnalisé au secteur et à l'identité de chaque entreprise de métier.

**Le problème réel résolu :**
Les dirigeants d'entreprises artisanales et industrielles (tôlerie, plomberie, menuiserie, rénovation, façade, charpente, etc.) consacrent jusqu'à 70% de leur temps à des tâches administratives sans outil adapté : devis réalisés manuellement sous Excel ou Word, facturation hors normes légales, aucun suivi client, aucune relance, mémoire d'entreprise concentrée dans la tête de deux personnes. Résultat : des semaines perdues sur des devis complexes, des opportunités commerciales manquées faute de relances, une incapacité à scaler sans recruter.

**Ce que l'utilisateur fait aujourd'hui pour résoudre ce problème :**
Excel pour les devis, Word pour les factures, un ERP obsolète (souvent Sage ou EBP) non paramétrable à leur secteur, des emails manuels pour relancer, un carnet de contacts ou un CRM mal utilisé. C'est insuffisant car ces outils sont génériques, déconnectés entre eux, et aucun ne comprend la logique métier (prix matériaux au kilo, taux horaire par corps de métier, règles de TVA sectorielles, etc.).

**La solution — ce que le produit fait précisément :**
Métier OS propose un outil tout-en-un qui comprend le métier de l'entreprise : il permet de créer des devis complexes depuis un cahier des charges PDF ou oral, de facturer aux normes françaises, de gérer ses clients comme dans un CRM, de relancer automatiquement, et de capitaliser sur la mémoire de l'entreprise pour assurer la cohérence tarifaire dans le temps. Chaque instance est branding-adaptée au client final.

**Ce que ce produit n'est PAS :**
- Ce n'est pas un outil comptable (pas de bilan, liasse fiscale, déclarations fiscales)
- Ce n'est pas un ERP industriel lourd type SAP ou Sage 100
- Ce n'est pas un outil de gestion de production/atelier
- Ce n'est pas un CRM marketing (campagnes emailing de masse, acquisition)
- Ce n'est pas un outil de paie

---

## 2. LE BUILDER

**Qui construit :** Entrepreneur solo — vibe coding assisté avec Cursor / Claude Code / Antigravity

**Niveau technique disponible :** Bon niveau — capable de superviser et diriger des agents IA sur une stack moderne Next.js / Supabase / Stripe

**Budget :** Early stage — minimiser les coûts fixes, maximiser la vitesse de déploiement

**Délai réaliste :** MVP complet en 6 à 10 semaines avec vibe coding intensif

**Objectif post-lancement :**
- Validation sur 2-3 clients pilotes (tôlerie industrielle en priorité)
- MRR cible à 6 mois : 5 000€/mois (5 à 10 clients sur plan Pro)
- Modèle de redéploiement : 1 nouveau secteur configuré en < 2 jours ouvrés

---

## 3. L'UTILISATEUR PRINCIPAL

**Profil :** Dirigeant de TPE/PME artisanale ou industrielle — 2 à 30 salariés. Titre : Gérant, Directeur Général, PDG. Pas de DSI, pas de DG, souvent tout-en-un. Utilise aujourd'hui Excel, Word, Sage EBP ou rien du tout.

**Contexte d'usage exact :** Au bureau, souvent entre deux chantiers ou en fin de journée. Parfois sur chantier depuis son téléphone pour capturer une demande client à chaud. Dans le flux de travail commercial : réception d'une demande → préparation du devis → envoi → attente → relance → commande → facturation.

**Jobs To Be Done :**
- "Je veux répondre vite à une demande de devis complexe sans y passer 3 jours"
- "Je veux savoir où en est chaque client sans avoir à tout retenir dans ma tête"
- "Je veux être payé sans courir après mes clients à chaque facture"
- "Je veux que mon collaborateur puisse me seconder sans tout réapprendre"

**Freins à l'adoption :**
- "Je n'ai pas le temps de former tout le monde à un nouvel outil"
- "Mon secteur est trop spécifique, les outils génériques ne comprennent rien"
- "J'ai déjà essayé un CRM, ça n'a jamais vraiment été utilisé"
- Peur de perdre ses données historiques

**Ce qui le ferait abandonner après 7 jours :**
- L'outil ne comprend pas sa logique métier (unités, terminologie, calculs)
- Trop de clics pour faire un devis simple
- Import de données trop complexe ou impossible
- Interface perçue comme "trop informatique" pour lui et ses équipes

---

## 4. LE MODÈLE ÉCONOMIQUE

**Type :** Abonnement mensuel/annuel B2B (SaaS per-tenant)

**Plans envisagés :**

| Plan | Prix | Cible | Limites |
|------|------|-------|---------|
| **Starter** | 79€/mois | Artisan solo, 1 utilisateur | 1 user, 50 devis/mois, 50 clients, pas d'IA vocale |
| **Pro** | 199€/mois | PME 2-10 personnes | 5 users, illimité devis/clients, IA vocale, relances auto, intégrations CRM |
| **Business** | 399€/mois | PME 10-30 personnes | 15 users, multi-site, branding avancé, API, onboarding dédié |
| **Enterprise** | Sur devis | Groupe multi-entités | Illimité, SSO, audit logs, déploiement custom |

**Ce qui est gratuit :** Période d'essai 14 jours sur le plan Pro — sans carte bancaire

**Ce qui est payant et pourquoi :**
- Le nombre de collaborateurs (valeur directe : délégation, scaling)
- L'IA vocale et le traitement de cahier des charges PDF (valeur différenciante majeure)
- Les relances automatiques (temps économisé mesurable)
- Les intégrations CRM tierces (Hubspot, Salesforce)

**Metric d'expansion revenue :** Seats additionnels au-delà des limites du plan (5€/user/mois)

---

## 5. LA CONCURRENCE

**1. Pennylane**
Force : facturation électronique française solide, intégration comptable
Faiblesse : pas de logique métier sectorielle, pas d'assistant devis IA, pas de CRM
→ On gagne sur : l'assistant devis complexe, la compréhension métier, le CRM intégré

**2. Sellsy**
Force : CRM + facturation combinés, bien établi en France
Faiblesse : très générique, interface dense et complexe, pas d'IA vocale, pas de templates sectoriels
→ On gagne sur : la simplicité d'usage terrain, l'IA intégrée, la personnalisation sectorielle

**3. Monday.com / Notion (utilisés en substitut)**
Force : flexibilité infinie, adoption facile
Faiblesse : aucune logique métier, pas de facturation, pas de calcul de devis, pas de normes françaises
→ On gagne sur : un outil qui fait vraiment leur métier, pas besoin de tout configurer soi-même

**Positionnement unique :**
Métier OS est le seul outil qui combine CRM + ERP + IA sectorielle pensé pour les entreprises de métier manuel en France, déployable en quelques heures avec le branding du client.

---

## 6. LES CONTRAINTES

**Stack :** Next.js 14 App Router + Supabase + Stripe + Vercel — imposé par le vibe coding workflow

**Auth :** Email + mot de passe (requis) + Google OAuth (optionnel, à prioriser pour l'adoption)

**Multi-tenancy :** Multi-org — chaque entreprise cliente a son espace isolé, son branding, ses utilisateurs, ses données

**Données sensibles :**
- RGPD obligatoire : données clients (noms, emails, SIRET, adresses)
- Données financières : montants des devis et factures
- Résidence des données : hébergement EU obligatoire (Supabase EU region)
- Facturation électronique : conformité Chorus Pro / Factur-X pour les clients soumis à la facture électronique obligatoire (B2B France, en vigueur progressivement depuis 2024-2026)

**Intégrations bloquantes (sans lesquelles le MVP ne peut pas être lancé) :**
- Génération PDF des devis/factures (conformes aux normes françaises)
- Envoi email transactionnel (devis, factures, relances)
- Stripe pour la facturation abonnements

**Intégrations P2 (post-lancement) :**
- HubSpot et Salesforce (import/sync contacts)
- Ma Prime Rénov (calcul des aides pour le secteur rénovation)
- Chorus Pro (facturation électronique B2G)

---

## 7. LES MÉTRIQUES DE SUCCÈS

**À 30 jours (activation) :**
- Taux d'activation : % d'utilisateurs ayant créé leur premier devis dans les 7 jours → cible > 60%
- Taux de complétion onboarding : > 80%
- Temps moyen pour créer le premier devis : < 10 minutes

**À 90 jours (rétention & conversion) :**
- Conversion trial-to-paid : > 25%
- Churn mensuel : < 5%
- DAU/MAU : > 40% (outil du quotidien)
- MRR : > 2 000€

**North Star Metric :** Nombre de devis créés via l'assistant IA par mois (prouve que l'outil crée de la valeur réelle, pas juste du stockage de données)

---

## 8. LES RISQUES

**Risques produit :**
- Hypothèse non validée : l'IA vocale est-elle réellement utilisée sur le terrain ? → Mitigé par interviews clients avant développement
- Trop de features P1 → réduire au strict MVP : devis + factures + CRM basique + relances

**Risques techniques :**
- Conformité facturation électronique française (Factur-X, Chorus Pro) : complexité légale et technique élevée → traiter en P2, Pennylane API en P1 comme fallback
- Traitement PDF des cahiers des charges : qualité variable des PDFs industriels → prévoir fallback texte manuel
- Multi-tenancy strict : isolation parfaite des données entre tenants → RLS Supabase + tests cross-tenant systématiques

**Risques business :**
- Cycle de vente B2B long : les PME signent lentement → pipeline pilote via réseau direct
- Résistance au changement : outil trop nouveau pour des dirigeants non-digitaux → UX ultra-simple + onboarding accompagné
- Concurrence Pennylane / Sellsy sur le positionnement CRM+Facturation → différenciation par l'IA sectorielle et le déploiement ultra-rapide

**Mitigation globale :** Commencer avec 1 secteur (tôlerie industrielle), valider, puis dupliquer le modèle sur d'autres secteurs.
