import { APP_NAME, APP_SIGNATURE, absoluteBrandAssetUrl, wordmarkForTheme } from '@/lib/brand'

/**
 * HTML email theme derived from the Atelier LP design system.
 *
 * Email clients do not reliably support pseudo-elements, web fonts, gradients,
 * or CSS animations. The visual language is therefore expressed with nested
 * tables, inline styles, a hard lower edge, and a nested inner frame.
 */
export const EMAIL_COLORS = {
  paper: '#F7F4EE',
  surface: '#FFFDF9',
  ink: '#080807',
  muted: '#6E6A62',
  line: '#D9D2C7',
  orange: '#FF9F1C',
  orangeEdge: '#A95800',
  green: '#B4F481',
  greenInk: '#24520E',
  red: '#A01212',
  redSurface: '#FFD9D9',
} as const

const FONT_STACK = `'Geist','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`

export type EmailBrand = {
  kind: 'atelier' | 'organization'
  name: string
  logoUrl?: string | null
  primaryColor?: string | null
  signature?: string | null
  replyTo?: string | null
  showPoweredBy?: boolean
}

export function atelierEmailBrand(overrides: Partial<EmailBrand> = {}): EmailBrand {
  return {
    kind: 'atelier',
    name: 'Atelier BTP',
    logoUrl: absoluteBrandAssetUrl(wordmarkForTheme('dark')),
    signature: null,
    replyTo: process.env.RESEND_REPLY_TO_ADDRESS?.trim() || 'contact@orsayn.fr',
    showPoweredBy: false,
    ...overrides,
  }
}

export function organizationEmailBrand(input: {
  name: string
  logoUrl?: string | null
  primaryColor?: string | null
  signature?: string | null
  replyTo?: string | null
}): EmailBrand {
  return {
    kind: 'organization',
    name: input.name,
    logoUrl: input.logoUrl ?? null,
    primaryColor: safeColor(input.primaryColor) ? input.primaryColor : EMAIL_COLORS.orange,
    signature: input.signature ?? null,
    replyTo: input.replyTo ?? null,
    showPoweredBy: true,
  }
}

function safeColor(value?: string | null): boolean {
  return Boolean(value && /^#[0-9a-f]{6}$/i.test(value.trim()))
}

function readableTextOn(color: string): string {
  if (!safeColor(color)) return EMAIL_COLORS.ink
  const hex = color.slice(1)
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const luminance = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
  return luminance > 0.55 ? EMAIL_COLORS.ink : '#FFFFFF'
}

/** Échappe les caractères HTML sensibles. */
export function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** Bouton CTA principal, rendu avec une ombre-socle compatible email. */
export function renderCTA(label: string, url: string, color = EMAIL_COLORS.orange): string {
  const textColor = readableTextOn(color)
  const edgeColor = color.toLowerCase() === EMAIL_COLORS.orange.toLowerCase() ? EMAIL_COLORS.orangeEdge : EMAIL_COLORS.ink
  return `
<table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 28px;">
  <tr>
    <td style="background:${color};border:1px solid ${edgeColor};border-radius:999px;box-shadow:0 4px 0 ${edgeColor};">
      <a href="${escHtml(url)}" role="button" style="display:inline-block;padding:15px 28px;color:${textColor};font-family:${FONT_STACK};font-size:14px;font-weight:700;line-height:1;text-decoration:none;">
        ${label}
      </a>
    </td>
  </tr>
</table>`
}

/** Bloc de code monospace centré (codes OTP). */
export function renderCodeBlock(code: string): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 24px;">
  <tr><td style="background:#FFF7EA;border:1px solid #E7C892;border-radius:16px;padding:25px;text-align:center;">
    <span style="color:${EMAIL_COLORS.ink};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:36px;font-weight:800;letter-spacing:8px;">${escHtml(code)}</span>
  </td></tr>
</table>`
}

/** Tableau de paires clé / valeur avec double cadre interne. */
export function renderInfoBox(
  rows: Array<{ label: string; value: string; large?: boolean }>,
  theme: 'default' | 'success' = 'default',
): string {
  const background = theme === 'success' ? '#F4FFE9' : '#F3EFE8'
  const border = theme === 'success' ? '#B9D99E' : EMAIL_COLORS.line
  const labelColor = theme === 'success' ? EMAIL_COLORS.greenInk : EMAIL_COLORS.muted
  const valueColor = theme === 'success' ? EMAIL_COLORS.greenInk : EMAIL_COLORS.ink
  const rowsHtml = rows.map(({ label, value, large }, index) => `
    <tr>
      <td style="padding:0 8px ${index < rows.length - 1 ? '10px' : '0'} 0;color:${labelColor};font-family:${FONT_STACK};font-size:13px;line-height:1.35;">${escHtml(label)}</td>
      <td style="padding:0 0 ${index < rows.length - 1 ? '10px' : '0'} 8px;color:${valueColor};font-family:${FONT_STACK};font-size:${large ? '18px' : '13px'};font-weight:${large ? '750' : '650'};line-height:1.35;text-align:right;">${value}</td>
    </tr>`).join('')

  return `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 28px;background:${background};border:1px solid ${border};border-radius:16px;">
  <tr><td style="padding:7px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid ${border};border-radius:10px;">
      <tr><td style="padding:16px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rowsHtml}</table>
      </td></tr>
    </table>
  </td></tr>
</table>`
}

/** Encadré de texte long (description client, message ou note). */
export function renderTextBox(text: string, label?: string): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 24px;">
  ${label ? `<tr><td style="padding:0 0 7px;color:${EMAIL_COLORS.muted};font-family:${FONT_STACK};font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;">${escHtml(label)}</td></tr>` : ''}
  <tr><td style="background:#F3EFE8;border:1px solid ${EMAIL_COLORS.line};border-radius:12px;padding:7px;">
    <div style="border:1px solid ${EMAIL_COLORS.line};border-radius:7px;padding:15px;color:#36332E;font-family:${FONT_STACK};font-size:14px;line-height:1.7;white-space:pre-wrap;">${escHtml(text)}</div>
  </td></tr>
</table>`
}

/** Bandeau d'état sémantique. */
export function renderAlertBanner(text: string, theme: 'success' | 'info' = 'success'): string {
  const background = theme === 'success' ? '#F4FFE9' : '#EEF0FF'
  const border = theme === 'success' ? '#B9D99E' : '#C7C5F4'
  const color = theme === 'success' ? EMAIL_COLORS.greenInk : '#35318B'
  return `
<tr><td style="background:${background};border-bottom:1px solid ${border};padding:14px 32px;">
  <p style="margin:0;color:${color};font-family:${FONT_STACK};font-size:14px;font-weight:700;line-height:1.45;">${text}</p>
</td></tr>`
}

function renderSignature(brand: EmailBrand): string {
  if (brand.kind === 'atelier') {
    return `<p style="margin:22px 0 0;color:${EMAIL_COLORS.muted};font-family:${FONT_STACK};font-size:13px;line-height:1.65;">Samuel<br/><strong style="color:${EMAIL_COLORS.ink};">Fondateur d’Atelier BTP</strong><br/><a href="mailto:${escHtml(brand.replyTo || 'contact@orsayn.fr')}" style="color:${EMAIL_COLORS.ink};text-decoration:underline;">${escHtml(brand.replyTo || 'contact@orsayn.fr')}</a></p>`
  }
  if (!brand.signature) return ''
  return `<p style="margin:22px 0 0;color:${EMAIL_COLORS.muted};font-family:${FONT_STACK};font-size:13px;line-height:1.65;white-space:pre-line;">${escHtml(brand.signature)}</p>`
}

/**
 * Shell principal compatible Gmail, Outlook et Apple Mail.
 * `brand` est absent pour conserver la compatibilité des anciens appels : le
 * nom d'en-tête permet de distinguer les messages Atelier des messages client.
 */
export function renderEmailShell({
  title,
  headerName,
  bodyHtml,
  footerName,
  headerColor,
  extraHeaderHtml = '',
  headerLogoUrl,
  alertHtml = '',
  fallbackLinkHtml = '',
  brand,
  includeSignature = false,
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
  brand?: EmailBrand
  includeSignature?: boolean
}): string {
  const resolvedBrand = brand ?? (
    [APP_NAME, APP_SIGNATURE, 'Atelier', 'Atelier BTP'].includes(headerName)
      ? atelierEmailBrand({ name: 'Atelier BTP' })
      : organizationEmailBrand({ name: headerName })
  )
  const accent = safeColor(resolvedBrand.primaryColor) ? resolvedBrand.primaryColor! : EMAIL_COLORS.orange
  const logo = headerLogoUrl ?? resolvedBrand.logoUrl
  const headerBackground = headerColor ?? EMAIL_COLORS.ink
  const footer = footerName ?? resolvedBrand.name
  const poweredBy = resolvedBrand.kind === 'organization' && resolvedBrand.showPoweredBy !== false
    ? `<br/><span style="color:#9A948A;">Propulsé par Atelier BTP</span>`
    : ''
  const signature = includeSignature ? renderSignature(resolvedBrand) : ''
  const supportLine = resolvedBrand.kind === 'atelier'
    ? `<p style="margin:10px 0 0;color:${EMAIL_COLORS.muted};font-family:${FONT_STACK};font-size:12px;line-height:1.5;">Une question ? <a href="mailto:${escHtml(resolvedBrand.replyTo || 'contact@orsayn.fr')}" style="color:${EMAIL_COLORS.ink};text-decoration:underline;">${escHtml(resolvedBrand.replyTo || 'contact@orsayn.fr')}</a></p>`
    : ''

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>${escHtml(title)}</title>
  <style>
    @font-face { font-family: 'Geist'; src: url('${absoluteBrandAssetUrl('/fonts/geist-variable.woff2') ?? ''}') format('woff2'); font-weight: 100 900; font-style: normal; }
    @media only screen and (max-width:620px) { .atelier-shell { width:100% !important; } .atelier-pad { padding-left:22px !important; padding-right:22px !important; } .atelier-hero { padding-top:28px !important; padding-bottom:28px !important; } }
  </style>
</head>
<body style="margin:0;padding:0;background:${EMAIL_COLORS.paper};font-family:${FONT_STACK};">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${EMAIL_COLORS.paper};padding:28px 12px;">
    <tr><td align="center">
      <table class="atelier-shell" width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:600px;max-width:600px;background:${EMAIL_COLORS.surface};border:1px solid ${EMAIL_COLORS.ink};border-radius:28px;overflow:hidden;box-shadow:0 5px 0 #B3AA9C,0 18px 40px rgba(43,34,20,.08);">
        <tr><td style="padding:7px;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid rgba(255,255,255,.22);border-radius:21px;overflow:hidden;">
            <tr><td class="atelier-hero" style="background:${headerBackground};padding:32px;">
              ${extraHeaderHtml}
              ${logo ? `<img src="${escHtml(logo)}" alt="${escHtml(resolvedBrand.name)}" style="display:block;width:auto;max-width:220px;height:30px;" />` : `<span style="color:#FFFFFF;font-family:${FONT_STACK};font-size:20px;font-weight:750;letter-spacing:-.03em;">${escHtml(resolvedBrand.name)}</span>`}
              ${resolvedBrand.kind === 'organization' && accent !== EMAIL_COLORS.orange ? `<div style="margin-top:18px;width:42px;height:4px;border-radius:999px;background:${accent};"></div>` : ''}
            </td></tr>
            ${alertHtml}
            <tr><td class="atelier-pad" style="padding:36px 32px 28px;color:${EMAIL_COLORS.ink};font-family:${FONT_STACK};">
              ${bodyHtml}
              ${signature}
              ${supportLine}
            </td></tr>
            ${fallbackLinkHtml ? `<tr><td class="atelier-pad" style="padding:0 32px 24px;">${fallbackLinkHtml}</td></tr>` : ''}
            <tr><td style="background:#EEE8DF;border-top:1px solid ${EMAIL_COLORS.line};padding:18px 24px;text-align:center;">
              <p style="margin:0;color:${EMAIL_COLORS.muted};font-family:${FONT_STACK};font-size:11px;line-height:1.5;"><strong style="color:${EMAIL_COLORS.ink};">${escHtml(footer)}</strong>${poweredBy}</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
