"use client"

import * as React from "react"

type Theme = "light" | "dark"

type ThemeContextValue = {
    theme: Theme
    setTheme: (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

function applyTheme(theme: Theme) {
    document.documentElement.classList.toggle("dark", theme === "dark")
    document.documentElement.style.colorScheme = theme
}

export function ThemeProvider({ children }: React.PropsWithChildren) {
    // Toujours rendre la même valeur au SSR et lors de la première hydratation.
    // La préférence enregistrée est appliquée juste après le rattachement React.
    const [theme, setThemeState] = React.useState<Theme>("light")

    React.useEffect(() => {
        const savedTheme = localStorage.getItem("theme")
        const initialTheme: Theme = savedTheme === "dark" || (
            savedTheme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches
        ) ? "dark" : "light"
        setThemeState(initialTheme)
        applyTheme(initialTheme)
    }, [])

    const setTheme = React.useCallback((nextTheme: Theme) => {
        localStorage.setItem("theme", nextTheme)
        applyTheme(nextTheme)
        setThemeState(nextTheme)
    }, [])

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    )
}

export function useTheme(): ThemeContextValue {
    const context = React.useContext(ThemeContext)
    if (!context) throw new Error("useTheme must be used within ThemeProvider")
    return context
}
