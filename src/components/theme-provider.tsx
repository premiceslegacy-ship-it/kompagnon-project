"use client";
// @atelier-migrated

import * as React from "react";
import { ThemeProvider as NextThemeProvider, useTheme as useNextTheme } from "next-themes";

type Theme = "light" | "dark";

type ThemeContextValue = {
    theme: Theme;
    setTheme: (theme: Theme) => void;
};

type ThemeProviderProps = React.PropsWithChildren<{
    operatorMode?: boolean;
    nonce?: string;
}>;

export function ThemeProvider({ children, operatorMode = false, nonce }: ThemeProviderProps) {
    return (
        <NextThemeProvider
            attribute="class"
            nonce={nonce}
            defaultTheme="system"
            enableSystem
            forcedTheme={operatorMode ? "light" : undefined}
            storageKey="theme"
        >
            {children}
        </NextThemeProvider>
    );
}

export function useTheme(): ThemeContextValue {
    const { forcedTheme, resolvedTheme, setTheme } = useNextTheme();
    const theme: Theme = (forcedTheme ?? resolvedTheme) === "dark" ? "dark" : "light";
    const setAppTheme = React.useCallback((nextTheme: Theme) => setTheme(nextTheme), [setTheme]);

    return { theme, setTheme: setAppTheme };
}
