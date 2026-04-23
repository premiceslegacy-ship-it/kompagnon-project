# BRAND-SYSTEM.md — Métier OS
### Identité de marque — Kael Ardent, Visual Architect

> ADN visuel : Apple-level premium · Dark Fintech · Liquid Glass · Précision industrielle

---

## SECTION 1 — FONDATION STRATÉGIQUE

### 1.1 La mission
Nous aidons les dirigeants d'entreprises de métier à récupérer leur temps et leur énergie en remplaçant l'anarchie administrative par un outil qui comprend vraiment leur secteur.

### 1.2 L'anti-mission
La marque refuse d'être :
- Un outil "pour tous" sans personnalité ni verticalité
- Une interface qui ressemble à un ERP des années 2010
- Une solution qui infantilise l'artisan ou le présente comme en retard
- Une plateforme froide, technocratique, sans chaleur humaine

La marque ne fait jamais :
- De la complexité pour montrer sa puissance
- Des interfaces surchargées de données non hiérarchisées
- Du jargon comptable ou informatique dans l'interface
- Des onboarding qui nécessitent une formation de 2 jours

### 1.3 La promesse client
**Avant :** Tu passes tes soirées sur Excel, tu cours après tes factures, ton devis le plus complexe te prend 3 semaines.
**Après :** Ton devis sort en 20 minutes depuis ton téléphone. Tes relances se font seules. Tu sais exactement où en est chaque client.

*La promesse concrète : Ce que tu faisais en 3 jours, tu le fais en 20 minutes.*

### 1.4 L'archétype Jungien — Le Souverain + Le Sage
**Souverain :** Métier OS donne à l'artisan/dirigeant la posture de celui qui maîtrise. Il reprend le contrôle, il décide, il pilote. L'outil est son instrument de pouvoir opérationnel.
**Sage :** L'outil comprend le métier, capitalise sur l'expérience, conseille. Il y a une intelligence derrière — pas un simple formulaire.

**Implication visuelle concrète :**
- Interfaces denses mais lisibles — la data est là, bien rangée, pas cachée
- Tons sombres et profonds — autorité et sérieux sans austérité
- Accent doré/ambre — excellence artisanale, précision, valeur
- Typographie précise et structurée — le Sage qui sait, le Souverain qui décide

### 1.5 Le registre de direction artistique
**3 mots :** Précision · Maîtrise · Confiance

---

## SECTION 2 — IDENTITÉ VERBALE

### Vocabulaire autorisé
- "Créer", "Générer", "Envoyer", "Relancer", "Suivre", "Piloter"
- "Votre client", "Votre devis", "Votre chantier"
- "En un clic", "En 20 minutes", "Automatiquement"
- "Conforme", "Professionnel", "Précis"
- Noms métier du secteur : "tôle", "pièce", "chantier", "bon de commande", "appel d'offre"

### Vocabulaire interdit
- "Révolutionnaire", "Disruptif", "Game-changer"
- Jargon informatique dans l'UI : "database", "API", "payload", "sync"
- Condescendance implicite : "Facile même pour les débutants"
- Vague : "Solution complète", "Tout-en-un puissant"
- Anglicismes non nécessaires dans l'UI française

### Ton de la microcopy
**Erreurs :** Direct, humain, actionnable — jamais technique
*Exemple : "Ce SIRET n'est pas reconnu. Vérifiez le format (14 chiffres sans espaces)."*

**Succès :** Sobre, confirmant — pas célébrant de manière excessive
*Exemple : "Devis envoyé à Michel Renard — 14 nov. 2024, 14h32."*

**Empty states :** Orienté action, jamais vide sans sens
*Exemple : "Aucun devis encore. Créez votre premier devis en 2 minutes."*

**Onboarding :** Direct et confiant — l'outil sait ce qu'il fait
*Exemple : "Commencez par paramétrer votre taux horaire. Tout le reste s'en déduira."*

---

## SECTION 3 — PALETTE DE COULEURS

### Palette principale — Dark Industrial Premium

```
FOND BASE           #080810   — near-black, légèrement bleuté (pas de noir pur)
FOND ELEVATED       #0d0d1a   — cards de premier niveau
FOND SURFACE        #12121f   — cards de second niveau, sidebars
FOND INTERACTIVE    #1a1a2e   — hover states, selected rows

TEXTE PRINCIPAL     #f0f0f5   — blanc légèrement chaud — lisibilité maximale
TEXTE SECONDAIRE    #9494a8   — labels, métadonnées
TEXTE MUTED         #5a5a6e   — placeholders, hints, microcopy

ACCENT PRIMAIRE     #f59e0b   — ambre industriel — CTA, highlights, actifs
ACCENT GLOW         rgba(245, 158, 11, 0.20) — halos sur CTA
ACCENT SECONDAIRE   #6366f1   — indigo — liens, badges secondaires
ACCENT TERTIARY     #10b981   — vert émeraude — succès, validé, payé

DANGER              #ef4444   — rouge — erreurs, suppression, impayé
WARNING             #f97316   — orange — attention, en attente, relance
INFO                #3b82f6   — bleu — information, neutre

BORDER SUBTLE       rgba(255, 255, 255, 0.06)
BORDER DEFAULT      rgba(255, 255, 255, 0.10)
BORDER ELEVATED     rgba(255, 255, 255, 0.16)
BORDER ACCENT       rgba(245, 158, 11, 0.30)
```

### Logique sémantique des couleurs dans l'UI

| Statut | Couleur | Usage |
|--------|---------|-------|
| Devis envoyé | Indigo #6366f1 | Badge statut |
| Devis accepté | Vert #10b981 | Badge statut |
| Devis refusé | Rouge #ef4444 | Badge statut |
| Facture payée | Vert #10b981 | Badge statut |
| Facture en attente | Ambre #f59e0b 40% | Badge statut |
| Facture en retard | Rouge #ef4444 | Badge statut |
| Lead chaud | Ambre #f59e0b | Indicateur CRM |
| Lead froid | Muted #5a5a6e | Indicateur CRM |

---

## SECTION 4 — TYPOGRAPHIE

### Polices choisies — Souverain + Sage

**Titre (display) : Plus Jakarta Sans**
*Justification : Géométrique sans-serif premium, précision fintech, autorité sans froideur. Parfait pour l'archétype Souverain/Sage.*

**Corps : Inter**
*Justification : Lisibilité maximale sur données denses, tables, formulaires. Standard de l'excellence SaaS.*

### Hiérarchie typographique

```
HERO / PAGE TITLE   Plus Jakarta Sans  · 36px · 700 · tracking -0.02em · #f0f0f5
H1                  Plus Jakarta Sans  · 28px · 700 · tracking -0.02em · #f0f0f5
H2                  Plus Jakarta Sans  · 22px · 600 · tracking -0.01em · #f0f0f5
H3                  Plus Jakarta Sans  · 18px · 600 · tracking 0       · #f0f0f5
H4 / SECTION LABEL  Inter             · 12px · 600 · tracking 0.08em  · #9494a8 (uppercase)
BODY LARGE          Inter             · 16px · 400 · leading 1.6      · #f0f0f5
BODY DEFAULT        Inter             · 14px · 400 · leading 1.5      · #f0f0f5
BODY SMALL          Inter             · 13px · 400 · leading 1.4      · #9494a8
CAPTION             Inter             · 12px · 400 · leading 1.3      · #9494a8
MICROCOPY           Inter             · 11px · 400 · opacity 0.5      · #9494a8
CHIFFRES FINTECH    Inter             · tabular-nums · tous les montants et KPIs
```

---

## SECTION 5 — ICONOGRAPHIE

**Bibliothèque :** Lucide React — stroke-width 1.5px sur toute la plateforme, sans exception

**Icônes clés du produit :**
```
Devis           FileText
Facture         Receipt
Client/CRM      Users
Prospect        UserPlus
Relance         Bell / RefreshCw
Assistant IA    Sparkles
Oral/Voix       Mic
PDF             FileDown
Matériaux       Package
Taux horaire    Clock
Chantier        HardHat
Tableau de bord BarChart2
Paramètres      Settings2
Multi-user      UserCircle2
Organisation    Building2
```

**Interdits absolus :**
- Emojis dans l'interface (sauf dans les communications clients générées)
- Icônes cartoon ou colorées sans cohérence
- Styles stroke + fill mélangés

---

## SECTION 6 — LOGO ET IDENTITÉ VISUELLE

### Concept logotype
**Wordmark :** "Métier OS" — Plus Jakarta Sans 700 — #f0f0f5
**Symbole (optionnel) :** Un hexagone minimal stylisé (référence industrielle : pièce mécanique, boulon, précision) avec un accent ambre sur un angle — évoque à la fois la précision artisanale et la technologie.

### Déclinaisons
- Fond sombre (usage principal) : wordmark blanc + accent ambre
- Fond clair (docs, exports PDF) : wordmark #080810 + accent ambre
- Icône app 1:1 : hexagone ambre sur fond #080810

### Positionnement dans l'interface
- Top-left de la sidebar : logo 28px height
- Favicon : hexagone seul sur fond sombre
- En-tête des PDFs générés (devis/factures) : version fond clair

---

## SECTION 7 — REFERENCES ET ANTI-REFERENCES

### Références positives (dans le bon registre)
1. **Linear** — Dashboard dense, navigation claire, dark premium sans lourdeur
2. **Stripe Dashboard** — Données financières lisibles, hiérarchie parfaite, typographie précise
3. **Vercel Dashboard** — Élévation glass subtile, interactions micro-soignées, vide actif

### Anti-références (directions à éviter absolument)
1. **Salesforce / SAP** — Interfaces surchargées, densité sans lisibilité, UX années 2010
2. **Notion (style light)** — Trop informel, trop "blog", pas adapté à des données financières
3. **Sage / EBP** — Rétro, couleurs primaires basiques, aucune hiérarchie visuelle

---

## SECTION 8 — DÉCLINAISON PAR SECTEUR (Branding Layer)

La plateforme permet d'adapter ces éléments par tenant/client :

**Variables exposées dans le panneau d'administration :**
```
primary_color     → remplace l'accent ambre (#f59e0b) par la couleur du client
logo_url          → logo du client en format SVG ou PNG fond transparent
company_name      → remplace "Métier OS" dans l'interface (option white-label)
sector_name       → affiché dans les sous-titres contextuels
font_override     → optionnel — permet une police différente pour les titres
```

**Ce qui ne change JAMAIS (ADN immuable) :**
- Les fonds sombres (#080810 · #0d0d1a · #12121f)
- Le système d'espacement 8px grid
- Les composants glass et leur style
- La hiérarchie typographique
- Les standards d'accessibilité WCAG 2.2 AA

**Exemples de déclinaisons :**
- Tôlerie industrielle → accent acier : `#94a3b8`
- Plomberie → accent bleu eau : `#0ea5e9`
- Rénovation/BTP → accent béton chaud : `#a78bfa`
- Menuiserie → accent bois naturel : `#d97706`
- Électricité → accent jaune sécurité : `#eab308`
