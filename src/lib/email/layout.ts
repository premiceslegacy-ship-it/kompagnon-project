/**
 * Layout HTML partagé pour tous les emails produit.
 * Génère un shell table-based compatible email (Gmail, Outlook, Apple Mail).
 */

const FONT_STACK = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`

/** Échappe les caractères HTML sensibles. */
export function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Bouton CTA principal (fond noir). */
export function renderCTA(label: string, url: string): string {
  return `
<table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
  <tr>
    <td style="background:#0a0a0a;border-radius:10px;">
      <a href="${url}"
         style="display:inline-block;padding:15px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:-0.2px;font-family:${FONT_STACK};">
        ${label}
      </a>
    </td>
  </tr>
</table>`
}

/** Bloc de code monospace centré (codes OTP). */
export function renderCodeBlock(code: string): string {
  return `
<div style="background:#f4f4f5;border-radius:12px;padding:28px;text-align:center;margin-bottom:28px;">
  <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#0a0a0a;font-family:monospace;">${escHtml(code)}</span>
</div>`
}

/**
 * Tableau de paires clé / valeur dans un encadré gris.
 * rows: tableau de { label, value, large?: boolean }
 * theme: 'default' | 'success'
 */
export function renderInfoBox(
  rows: Array<{ label: string; value: string; large?: boolean }>,
  theme: 'default' | 'success' = 'default',
): string {
  const bg = theme === 'success' ? '#f0fdf4' : '#f8f8f8'
  const border = theme === 'success' ? 'border:1px solid #bbf7d0;' : 'border:1px solid #efefef;'
  const labelColor = theme === 'success' ? '#166534' : '#888'
  const valueColor = theme === 'success' ? '#15803d' : '#333'

  const rowsHtml = rows.map(({ label, value, large }, i) => `
    <tr>
      <td style="font-size:13px;color:${labelColor};padding-bottom:${i < rows.length - 1 ? '8px' : '0'};">${escHtml(label)}</td>
      <td style="font-size:${large ? '18px' : '13px'};font-weight:${large ? '700' : '600'};color:${valueColor};text-align:right;padding-bottom:${i < rows.length - 1 ? '8px' : '0'};">${value}</td>
    </tr>`).join('')

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
  <tr>
    <td style="background:${bg};${border}border-radius:12px;padding:20px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${rowsHtml}
      </table>
    </td>
  </tr>
</table>`
}

/**
 * Encadré pour afficher un texte long (description client, message).
 * Pleine largeur, white-space:pre-wrap, fond légèrement teinté.
 */
export function renderTextBox(text: string, label?: string): string {
  return `
<div style="margin-bottom:24px;">
  ${label ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.8px;font-family:${FONT_STACK};">${escHtml(label)}</p>` : ''}
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;">
    <p style="margin:0;font-size:14px;color:#334155;line-height:1.7;white-space:pre-wrap;font-family:${FONT_STACK};">${escHtml(text)}</p>
  </div>
</div>`
}

/** Bandeau d'alerte coloré sous le header. theme: 'success' | 'info' */
export function renderAlertBanner(text: string, theme: 'success' | 'info' = 'success'): string {
  const bg = theme === 'success' ? '#f0fdf4' : '#eff6ff'
  const border = theme === 'success' ? '#bbf7d0' : '#bfdbfe'
  const color = theme === 'success' ? '#15803d' : '#1e40af'

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
 * @param headerName  Texte du header noir (nom d'org)
 * @param bodyHtml    Contenu HTML du corps (entre header et footer)
 * @param footerName  Texte du footer (nom d'org)
 * @param headerColor Couleur de fond du header (défaut #0a0a0a)
 * @param extraHeaderHtml HTML supplémentaire dans le header (ex : icône checkmark)
 * @param alertHtml   Bandeau d'alerte HTML (renderAlertBanner) — placé entre header et body
 * @param fallbackLinkHtml HTML du lien alternatif (placé entre body et footer)
 */
export function renderEmailShell({
  title,
  headerName,
  bodyHtml,
  footerName,
  headerColor = '#0a0a0a',
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
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:${FONT_STACK};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:${headerColor};padding:36px 48px;${headerColor !== '#0a0a0a' ? '' : ''}">
              ${extraHeaderHtml}
              ${headerLogoUrl ? `<img src="${headerLogoUrl}" alt="${escHtml(headerName)}" style="display:block;height:28px;width:auto;max-width:220px;margin:0 0 14px;" />` : ''}
              <span style="color:#ffffff;font-size:21px;font-weight:700;letter-spacing:-0.5px;font-family:${FONT_STACK};">${escHtml(headerName)}</span>
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
            <td style="background:#f9f9f9;border-top:1px solid #eee;padding:20px 48px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#bbb;font-family:${FONT_STACK};">
                <strong style="color:#999;">${escHtml(footer)}</strong>
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
