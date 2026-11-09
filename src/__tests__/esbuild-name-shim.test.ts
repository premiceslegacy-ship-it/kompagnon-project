import { describe, expect, it } from 'vitest'
import { ESBUILD_NAME_SHIM } from '@/lib/esbuild-name-shim'

describe('esbuild-name-shim', () => {
  it('définit __name pour que le script anti-flash du thème ne plante plus', () => {
    const scope: { __name?: unknown } = {}
    // Le script s'exécute avec `window` ; on le fournit pour la vérification.
    new Function('window', ESBUILD_NAME_SHIM)(scope)
    expect(typeof scope.__name).toBe('function')
    // Même appel que celui injecté par esbuild : retourne la fonction telle quelle.
    const fn = () => 1
    expect((scope.__name as (f: unknown, n: string) => unknown)(fn, 'fn')).toBe(fn)
  })

  it('ne remplace pas une définition déjà présente', () => {
    const existing = () => 'déjà là'
    const scope = { __name: existing }
    new Function('window', ESBUILD_NAME_SHIM)(scope)
    expect(scope.__name).toBe(existing)
  })
})
