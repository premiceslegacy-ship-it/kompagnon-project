import type { Config } from "tailwindcss"

const config = {
  darkMode: "class",
  content: [
    './src/app/**/*.{js,ts,jsx,tsx}',
    './src/components/**/*.{js,ts,jsx,tsx}',
    './src/lib/**/*.{js,ts,jsx,tsx}'
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
          green: "rgb(var(--success) / <alpha-value>)",
        },
        success: "rgb(var(--success) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
      },
      boxShadow: {
        'kompagnon': 'var(--elevation-shadow)',
        'glow-accent': '0 0 30px rgba(255, 159, 28, 0.3)',
        'glow-green': '0 0 40px rgba(16, 185, 129, 0.25)',
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
        display: ['var(--font-jakarta)', 'sans-serif'],
        body: ['var(--font-inter)', 'sans-serif'],
      },
    }
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config

export default config
