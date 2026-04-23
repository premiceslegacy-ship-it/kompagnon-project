```markdown
# DESIGN-SYSTEM.md — Atelier
### Système de design complet — Tokens pour Claude Code / Cursor / AI
### Kael Ardent · ADN : Soft Clean SaaS (Clair) ↔ Dark Liquid Glass (Sombre)

> **Règle absolue :** Ce fichier est la source de vérité visuelle de Atelier. L'architecture repose sur un mode Dual strict et sur l'**inversion de l'élévation** : 
> - Mode Clair = profondeur par ombres diffuses + fonds opaques.
> - Mode Sombre = profondeur par flou (blur) + bordures lumineuses.

---

## SECTION 1 — TOKENS DE COULEURS (CSS Variables : globals.css)

Nous utilisons le format RGB brut pour permettre à Tailwind d'injecter des opacités dynamiques (`/10`, `/50`).

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* ☀️ LIGHT MODE : Soft Clean SaaS */
    
    /* Fonds */
    --bg-base: 244 246 249;       /* #F4F6F9 - Gris-bleu très clair (Lavande) */
    --bg-surface: 255 255 255;    /* #FFFFFF - Blanc pur opaque pour les cartes */
    --bg-interactive: 248 250 252;/* #F8FAFC - Inputs et zones de drop */
    
    /* Texte */
    --text-primary: 30 41 59;     /* #1E293B - Slate profond (jamais noir pur) */
    --text-secondary: 100 116 139;/* #64748B - Gris doux */
    --text-inverse: 255 255 255;  /* Blanc sur boutons foncés */
    
    /* Élévation : Ombres fortes, Bordures invisibles, Zéro blur */
    --elevation-shadow: 0 10px 40px -10px rgba(0,0,0,0.05);
    --elevation-border: transparent;
    --glass-blur: 0px;

    /* Accents */
    --accent-primary: 255 159 28; /* #FF9F1C - Ambre Atelier */
    --accent-navy: 26 29 42;      /* #1A1D2A - Bleu Marine profond pour les gros CTA clairs */

    /* Sémantique */
    --success: 16 185 129;
    --danger: 239 68 68;
    --warning: 249 115 22;
  }

  .dark {
    /* 🌙 DARK MODE : Dark Liquid Glass (Apple visionOS style) */
    
    /* Fonds */
    --bg-base: 5 5 5;             /* #050505 - OLED Black abyssal */
    --bg-surface: 255 255 255;    /* Appliqué à 2% ou 3% d'opacité via Tailwind */
    --bg-interactive: 255 255 255;/* Appliqué à 4% d'opacité */

    /* Texte */
    --text-primary: 255 255 255;  /* #FFFFFF - Blanc pur */
    --text-secondary: 161 161 170;/* #A1A1AA - Gris perle */
    --text-inverse: 5 5 5;        /* Noir sur boutons clairs */

    /* Élévation : Ombres invisibles, Bordures lumineuses, Blur massif */
    --elevation-shadow: none;
    --elevation-border: rgba(255, 255, 255, 0.05);
    --glass-blur: 40px;           /* Blur intense Liquid Glass */

    /* Accents */
    --accent-primary: 255 159 28; /* L'Ambre explose sur fond noir */
    --accent-navy: 255 255 255;   /* Le navy devient blanc pur en dark mode */

    /* Sémantique */
    --success: 180 244 129;       /* Vert Néon #B4F481 */
    --danger: 255 71 87;          /* Rouge Néon */
    --warning: 255 159 28;
  }
}

@layer base {
  body {
    @apply bg-base text-primary transition-colors duration-300;
  }
}

```

---

## SECTION 2 — TAILWIND CONFIG EXTENSION (`tailwind.config.ts`)

```typescript
import type { Config } from "tailwindcss"

const config = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        base: "rgb(var(--bg-base) / <alpha-value>)",
        surface: "rgb(var(--bg-surface) / <alpha-value>)",
        interactive: "rgb(var(--bg-interactive) / <alpha-value>)",
        primary: "rgb(var(--text-primary) / <alpha-value>)",
        secondary: "rgb(var(--text-secondary) / <alpha-value>)",
        inverse: "rgb(var(--text-inverse) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--accent-primary) / <alpha-value>)",
          navy: "rgb(var(--accent-navy) / <alpha-value>)",
        },
        success: "rgb(var(--success) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
      },
      boxShadow: {
        'atelier': 'var(--elevation-shadow)',
        'glow-accent': '0 0 30px rgba(255, 159, 28, 0.3)',
        'glow-indigo': '0 0 60px rgba(99, 102, 241, 0.2)',
      },
      backdropBlur: {
        'glass': 'var(--glass-blur)',
      },
      borderRadius: {
        'xl': '1rem',
        '2xl': '1.25rem',
        '3xl': '1.5rem',  /* 24px - Standard pour les cartes */
        '4xl': '2rem',    /* 32px - Grandes zones (IA, Dashboard) */
        'pill': '9999px', /* Boutons, badges, barre de recherche */
      },
      fontFamily: {
        display: ['Plus Jakarta Sans', 'sans-serif'],
        body:    ['Inter', 'sans-serif'],
      },
    }
  }
} satisfies Config

export default config

```

---

## SECTION 3 — GRILLE ET ESPACEMENTS (Breathing Room)

L'UX de Atelier nécessite énormément de respiration.
**Règle absolue : Grille 8px.**

* `12px` / `16px` : Padding interne des petits composants (inputs, badges).
* `24px` : Padding standard des `AtelierCard`.
* `32px` : Gap standard entre les cartes dans les grilles (Bento UI).
* `48px` / `64px` : Gaps entre les grandes sections d'une page.

---

## SECTION 4 — COMPOSANTS ARCHITECTURAUX (Specs Exactes)

### 4.1 — KOMPAGNON CARD (Le conteneur universel)

**Interdit :** Ne jamais coder de `bg-white shadow-md` à la main.
Utiliser cette structure systématiquement pour garantir le Dual-Mode.

```tsx
<div className="
  rounded-3xl 
  p-6
  /* Clair */
  bg-surface shadow-atelier 
  /* Sombre */
  dark:bg-surface/2 dark:backdrop-blur-glass dark:border dark:border-[var(--elevation-border)]
  /* Animation */
  transition-all duration-300 ease-out
">
  {children}
</div>

```

### 4.2 — BOUTONS ET ACTIONS

**Boutons principaux & CTA (Forme Pilule absolue) :**
Toujours `rounded-pill`.
Pour les actions "magiques" (IA, Créer Devis), intégrer le composant `@/components/ui/liquid-glass-button.tsx` (LiquidButton) pour l'effet de distorsion SVG.

**Boutons secondaires (Ghost / Glass) :**

```tsx
<button className="rounded-pill px-6 py-2 bg-interactive text-secondary hover:text-primary hover:bg-interactive/80 transition-colors">
  Annuler
</button>

```

### 4.3 — TYPOGRAPHIE

* **H1 / Titres :** `font-display font-extrabold tracking-tight` (-0.02em).
* **Corps :** `font-body font-normal leading-relaxed`.
* **Données Financières :** `font-variant-numeric: tabular-nums` (OBLIGATOIRE sur tous les prix, dates, montants, totaux HT/TTC).

### 4.4 — BADGES STATUTS (Forme Pilule)

```tsx
/* Succès (Payé, Actif, Accepté) */
<span className="rounded-pill px-3 py-1 text-xs font-bold bg-success/15 text-success border border-success/20">Payé</span>

/* Danger (Retard, Refusé) */
<span className="rounded-pill px-3 py-1 text-xs font-bold bg-danger/15 text-danger border border-danger/20">En retard</span>

/* Attention (En attente, Lead chaud) */
<span className="rounded-pill px-3 py-1 text-xs font-bold bg-warning/15 text-warning border border-warning/20">En attente</span>

```

### 4.5 — INPUTS ET ÉDITEURS (Factures)

Dans l'éditeur de factures, les inputs doivent être "invisibles" pour ne pas surcharger la page.

```tsx
<input className="bg-transparent border-transparent focus:border-accent focus:bg-interactive/50 rounded-xl px-3 py-2 transition-all outline-none" />

```

### 4.6 — ÉTATS DE COMPOSANTS (Règle des 4 états)

1. **LOADING :** Skeleton Shimmer (preserve exactement la forme du contenu).
2. **EMPTY :** Jamais de vide total. Icône + Message humain + CTA Primaire.
3. **ERROR :** Card bordure rouge + "Réessayer" + Jamais de code d'erreur brut.
4. **LOADED :** Fade-in 200ms.

---

## SECTION 5 — ACCESSIBILITÉ & ICONOGRAPHIE

* **Icônes :** Lucide React EXCLUSIVEMENT. `stroke-width={1.5}` absolu. Jamais de stroke 2 (trop grossier sur fond sombre).
* **Icônes "Magiques" :** Les icônes liées à l'IA ne doivent pas subir de flou (pas de filtre SVG direct dessus). Appliquer un `drop-shadow` de couleur (`shadow-glow-indigo` ou ambre) pour l'effet néon.
* **Focus :** Pas de `outline: none` sans ring. Au clavier : `focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base`.

---

## SECTION 6 — INTERDITS ABSOLUS (Vétos Kael Ardent)

```text
❌ Coder une couleur hexadécimale en dur dans un composant (ex: bg-[#050505]). Toujours passer par Tailwind (bg-base).
❌ Utiliser un fond blanc pur comme background principal (#ffffff).
❌ Utiliser des ombres classiques (box-shadow) en mode sombre (elles sont invisibles, utiliser le border/blur).
❌ Mettre du glassmorphism sur le mode clair (le flou ne se voit pas et rend l'interface sale).
❌ Utiliser des Emojis dans l'UI (Navigation, boutons, titres).
❌ Animations de plus de 300ms.
❌ Oublier le `tabular-nums` sur des données financières (les colonnes doivent être parfaitement alignées).
❌ Utiliser des angles carrés ou peu arrondis (Atelier = arrondi massif 24px à 9999px).

```

```

```