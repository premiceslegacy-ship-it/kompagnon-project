/**
 * Le build Cloudflare (esbuild avec « keepNames ») ajoute des appels à `__name(fn, "nom")`
 * dans le code des fonctions. Le script anti-flash de next-themes est recopié tel quel
 * dans la page : il appelle alors `__name`, qui n'existe pas dans le navigateur, et plante
 * (« __name is not defined ») avant d'appliquer le thème. Ce script en ligne, posé avant,
 * définit la fonction d'aide manquante.
 */
export const ESBUILD_NAME_SHIM = 'window.__name=window.__name||function(f){return f}'
