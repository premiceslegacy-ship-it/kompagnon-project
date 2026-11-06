// Intégration : lien public et extraits de code à coller sur le site de l'artisan.
// Pas de marqueur @atelier-migrated : le bouton flottant est du code livré sur un site tiers, avec sa propre couleur.

/** Couleur du bouton flottant proposé aux artisans : l'orange Atelier, texte noir. */
const WIDGET_BACKGROUND = '#FF9F1C'
const WIDGET_SHADOW = 'rgba(255,159,28,0.4)'

export const publicFormUrl = (appUrl: string, slug: string) => `${appUrl}/demande/${slug}`

export function iframeSnippet(url: string): string {
  return `<iframe\n  src="${url}"\n  width="100%"\n  height="720"\n  frameborder="0"\n  style="border-radius:16px;border:none;"\n  title="Demande de devis"\n></iframe>`
}

export function widgetSnippet(url: string): string {
  return `<!-- Bouton flottant ATELIER -->
<script>
  (function() {
    var btn = document.createElement('a');
    btn.href = '${url}';
    btn.target = '_blank';
    btn.textContent = 'Demande de devis';
    btn.style.cssText = 'position:fixed;bottom:24px;right:24px;background:${WIDGET_BACKGROUND};color:#000;font-weight:700;padding:14px 24px;border-radius:50px;text-decoration:none;box-shadow:0 4px 20px ${WIDGET_SHADOW};z-index:9999;font-family:sans-serif;font-size:14px;';
    document.body.appendChild(btn);
  })();
</script>`
}
