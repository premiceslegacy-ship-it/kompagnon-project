/**
 * Layout HTML partagé pour tous les emails produit.
 * Génère un shell table-based compatible email (Gmail, Outlook, Apple Mail).
 * Design system : Dark Liquid Glass
 */

const FONT_STACK = `'Plus Jakarta Sans','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`

/** Échappe les caractères HTML sensibles. */
export function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Bouton CTA principal (fond amber). */
export function renderCTA(label: string, url: string): string {
  return `
<table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
  <tr>
    <td style="background:#FF9F1C;border-radius:9999px;box-shadow:0 0 20px rgba(255,159,28,0.25);">
      <a href="${url}"
         style="display:inline-block;padding:16px 36px;font-size:15px;font-weight:700;color:#000000;text-decoration:none;letter-spacing:-0.2px;font-family:${FONT_STACK};">
        ${label}
      </a>
    </td>
  </tr>
</table>`
}

/** Bloc de code monospace centré (codes OTP). */
export function renderCodeBlock(code: string): string {
  return `
<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px;text-align:center;margin-bottom:28px;">
  <span style="font-size:40px;font-weight:800;letter-spacing:10px;color:#FF9F1C;font-family:monospace;">${escHtml(code)}</span>
</div>`
}

/**
 * Tableau de paires clé / valeur dans un encadré glass sombre.
 * rows: tableau de { label, value, large?: boolean }
 * theme: 'default' | 'success'
 */
export function renderInfoBox(
  rows: Array<{ label: string; value: string; large?: boolean }>,
  theme: 'default' | 'success' = 'default',
): string {
  const bg = theme === 'success' ? 'rgba(180,244,129,0.08)' : 'rgba(255,255,255,0.03)'
  const border = theme === 'success' ? 'border:1px solid rgba(180,244,129,0.2);' : 'border:1px solid rgba(255,255,255,0.07);'
  const labelColor = theme === 'success' ? '#B4F481' : '#A1A1AA'
  const valueColor = theme === 'success' ? '#B4F481' : '#FFFFFF'

  const rowsHtml = rows.map(({ label, value, large }, i) => `
    <tr>
      <td style="font-size:13px;color:${labelColor};padding-bottom:${i < rows.length - 1 ? '10px' : '0'};font-family:${FONT_STACK};">${escHtml(label)}</td>
      <td style="font-size:${large ? '18px' : '13px'};font-weight:${large ? '700' : '600'};color:${valueColor};text-align:right;padding-bottom:${i < rows.length - 1 ? '10px' : '0'};font-family:${FONT_STACK};">${value}</td>
    </tr>`).join('')

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
  <tr>
    <td style="background:${bg};${border}border-radius:16px;padding:20px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${rowsHtml}
      </table>
    </td>
  </tr>
</table>`
}

/**
 * Encadré pour afficher un texte long (description client, message).
 * Pleine largeur, white-space:pre-wrap, fond glass sombre.
 */
export function renderTextBox(text: string, label?: string): string {
  return `
<div style="margin-bottom:24px;">
  ${label ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.8px;font-family:${FONT_STACK};">${escHtml(label)}</p>` : ''}
  <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:18px 20px;">
    <p style="margin:0;font-size:14px;color:#A1A1AA;line-height:1.7;white-space:pre-wrap;font-family:${FONT_STACK};">${escHtml(text)}</p>
  </div>
</div>`
}

/** Bandeau d'alerte coloré sous le header. theme: 'success' | 'info' */
export function renderAlertBanner(text: string, theme: 'success' | 'info' = 'success'): string {
  const bg = theme === 'success' ? 'rgba(180,244,129,0.08)' : 'rgba(99,102,241,0.1)'
  const border = theme === 'success' ? 'rgba(180,244,129,0.2)' : 'rgba(99,102,241,0.25)'
  const color = theme === 'success' ? '#B4F481' : '#818cf8'

  return `
<tr>
  <td style="background:${bg};border-bottom:1px solid ${border};padding:18px 48px;">
    <p style="margin:0;font-size:15px;font-weight:600;color:${color};font-family:${FONT_STACK};">${text}</p>
  </td>
</tr>`
}

/**
 * Shell principal — génère le HTML complet d'un email.
 *
 * @param title       Sujet / titre (balise <title>)
 * @param headerName  Texte du header (nom d'org) — affiché seulement si pas de logo
 * @param bodyHtml    Contenu HTML du corps (entre header et footer)
 * @param footerName  Texte du footer (nom d'org)
 * @param headerColor Couleur de fond du header (défaut #050505)
 * @param extraHeaderHtml HTML supplémentaire dans le header (ex : icône checkmark)
 * @param headerLogoUrl URL du logo — si présent, remplace le texte headerName
 * @param alertHtml   Bandeau d'alerte HTML (renderAlertBanner) — placé entre header et body
 * @param fallbackLinkHtml HTML du lien alternatif (placé entre body et footer)
 */
export function renderEmailShell({
  title,
  headerName,
  bodyHtml,
  footerName,
  headerColor = '#050505',
  extraHeaderHtml = '',
  headerLogoUrl,
  alertHtml = '',
  fallbackLinkHtml = '',
}: {
  title: string
  headerName: string
  bodyHtml: string
  footerName?: string
  headerColor?: string
  extraHeaderHtml?: string
  headerLogoUrl?: string | null
  alertHtml?: string
  fallbackLinkHtml?: string
}): string {
  const footer = footerName ?? headerName
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(title)}</title>
  <style>@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&family=Inter:wght@400;600&display=swap');</style>
</head>
<body style="margin:0;padding:0;background:#050505;font-family:${FONT_STACK};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#050505;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border-radius:24px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);box-shadow:0 8px 32px rgba(0,0,0,0.6);">

          <!-- Header -->
          <tr>
            <td style="background:${headerColor};padding:40px 48px;">
              ${extraHeaderHtml}
              ${headerLogoUrl
                ? `<img src="${headerLogoUrl}" alt="${escHtml(headerName)}" style="display:block;height:28px;width:auto;max-width:220px;" />`
                : `<span style="color:#ffffff;font-size:21px;font-weight:700;letter-spacing:-0.5px;font-family:${FONT_STACK};">${escHtml(headerName)}</span>`
              }
            </td>
          </tr>

          ${alertHtml}

          <!-- Body -->
          <tr>
            <td style="padding:44px 48px 36px;font-family:${FONT_STACK};">
              ${bodyHtml}
            </td>
          </tr>

          ${fallbackLinkHtml ? `
          <!-- Fallback link -->
          <tr>
            <td style="padding:0 48px 28px;">
              ${fallbackLinkHtml}
            </td>
          </tr>` : ''}

          <!-- Footer -->
          <tr>
            <td style="background:#111111;border-top:1px solid rgba(255,255,255,0.06);padding:20px 48px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#555555;font-family:${FONT_STACK};">
                <strong style="color:#444444;">${escHtml(footer)}</strong>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
