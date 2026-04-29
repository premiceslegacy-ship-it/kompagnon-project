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
          secondary: "rgb(var(--accent-secondary) / <alpha-value>)",
          navy: "rgb(var(--accent-navy) / <alpha-value>)",
          green: "rgb(var(--success) / <alpha-value>)",
        },
        success: "rgb(var(--success) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
      },
      boxShadow: {
        'kompagnon': 'var(--elevation-shadow)',
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.8)',
        'glass-light': '0 8px 32px 0 rgba(0, 0, 0, 0.05)',
        'glow-accent': '0 0 30px rgba(255, 159, 28, 0.3)',
        'glow-accent-soft': '0 0 30px rgba(255, 159, 28, 0.15)',
        'glow-green': '0 0 40px rgba(180, 244, 129, 0.25)',
        'glow-indigo': '0 0 60px rgba(99, 102, 241, 0.2)',
      },
      backdropBlur: {
        'glass': 'var(--glass-blur)',
        'frost': '25px',
        'liquid': '40px',
      },
      borderRadius: {
        'xl': '1rem',        /* 16px */
        '2xl': '1.25rem',   /* 20px */
        '3xl': '1.5rem',    /* 24px */
        '4xl': '2rem',      /* 32px - Bento cards */
        'pill': '9999px',   /* Pill buttons & badges */
      },
      fontFamily: {
        display: ['var(--font-jakarta)', 'sans-serif'],
        body: ['var(--font-inter)', 'sans-serif'],
      },
      fontVariantNumeric: {
        'tabular': 'tabular-nums',
      },
    }
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config

export default config
