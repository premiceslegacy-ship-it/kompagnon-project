/**
 * Templates HTML pour les emails applicatifs produit.
 * Emails envoyés via Resend avec le compte du client.
 * Tous basés sur renderEmailShell (src/lib/email/layout.ts).
 */

import {
  renderEmailShell,
  renderCTA,
  renderCodeBlock,
  renderInfoBox,
  renderTextBox,
  renderAlertBanner,
  escHtml,
} from './layout'
import { APP_NAME, APP_SIGNATURE, absoluteBrandAssetUrl, wordmarkForTheme } from '@/lib/brand'

// ─── Invitation membre d'équipe ───────────────────────────────────────────────

export function buildInviteEmail({
  orgName,
  inviterName,
  inviteUrl,
}: {
  orgName: string
  inviterName: string
  inviteUrl: string
}): { subject: string; html: string } {
  const subject = `${inviterName} vous invite à rejoindre ${orgName}`

  const body = `
<h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#0a0a0a;line-height:1.3;">
  ${escHtml(inviterName)} vous a invité à rejoindre l'équipe !
</h1>
<p style="margin:0 0 32px;font-size:15px;color:#555;line-height:1.6;">
  Cliquez sur le bouton ci-dessous pour accepter l'invitation et créer votre compte.
</p>
${renderCTA(`Rejoindre ${escHtml(orgName)} →`, inviteUrl)}
<p style="margin:0;font-size:13px;color:#999;line-height:1.5;">
  Ce lien est valable <strong>7 jours</strong>. Si vous n'attendiez pas cette invitation, ignorez simplement cet email.
</p>`

  const fallback = `
<p style="margin:0;font-size:12px;color:#bbb;">
  Lien alternatif :<br/>
  <a href="${inviteUrl}" style="color:#555;word-break:break-all;">${inviteUrl}</a>
</p>`

  const html = renderEmailShell({
    title: subject,
    headerName: orgName,
    bodyHtml: body,
    fallbackLinkHtml: fallback,
  })

  return { subject, html }
}

// ─── OTP inscription ──────────────────────────────────────────────────────────

export function buildSignupOtpEmail({
  otp,
  orgName,
}: {
  otp: string
  orgName: string
}): { subject: string; html: string } {
  const subject = `Bienvenue chez ${orgName} : votre code de confirmation`

  const body = `
<h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#0a0a0a;line-height:1.3;">
  Bienvenue chez ${escHtml(orgName)} !
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">
  Votre espace de gestion est prêt. Saisissez le code ci-dessous pour confirmer votre adresse email et accéder à votre logiciel.
</p>
${renderCodeBlock(otp)}
<p style="margin:0;font-size:13px;color:#999;line-height:1.5;">
  Ce code est valable <strong>1 heure</strong>. Si vous n'avez pas créé de compte, ignorez simplement cet email.
</p>`

  const html = renderEmailShell({
    title: subject,
    headerName: orgName,
    headerLogoUrl: orgName === APP_SIGNATURE ? absoluteBrandAssetUrl(wordmarkForTheme('dark')) : null,
    bodyHtml: body,
  })

  return { subject, html }
}

// ─── OTP réinitialisation mot de passe ────────────────────────────────────────

export function buildPasswordResetOtpEmail({
  otp,
  orgName,
}: {
  otp: string
  orgName: string
}): { subject: string; html: string } {
  const subject = `Réinitialisation de votre mot de passe · ${orgName}`

  const body = `
<h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#0a0a0a;line-height:1.3;">
  Réinitialisez votre mot de passe
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">
  Saisissez ce code sur la page de réinitialisation pour choisir un nouveau mot de passe.
</p>
${renderCodeBlock(otp)}
<p style="margin:0;font-size:13px;color:#999;line-height:1.5;">
  Ce code est valable <strong>1 heure</strong>. Si vous n'avez pas demandé cette réinitialisation, ignorez cet email : votre mot de passe reste inchangé.
</p>`

  const html = renderEmailShell({
    title: subject,
    headerName: orgName,
    headerLogoUrl: orgName === APP_SIGNATURE ? absoluteBrandAssetUrl(wordmarkForTheme('dark')) : null,
    bodyHtml: body,
  })

  return { subject, html }
}

// ─── Devis envoyé au client ───────────────────────────────────────────────────

export function buildQuoteSentEmail({
  orgName,
  orgEmail,
  clientName,
  quoteNumber,
  quoteTitle,
  totalTtc,
  currency,
  validUntil,
  signUrl,
}: {
  orgName: string
  orgEmail: string
  clientName: string
  quoteNumber: string | null
  quoteTitle: string | null
  totalTtc: number | null
  currency: string
  validUntil: string | null
  signUrl: string
}): { subject: string; html: string } {
  const numText = quoteNumber ? ` N° ${quoteNumber}` : ''
  const subject = `Votre devis${numText} de ${orgName}`
  const numHtml = quoteNumber ? ` N° ${escHtml(quoteNumber)}` : ''

  const fmtAmt = totalTtc != null
    ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(totalTtc)
    : null
  const fmtDate = validUntil
    ? new Date(validUntil).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    : null

  const infoRows = [
    ...(fmtAmt ? [{ label: 'Montant TTC', value: fmtAmt, large: true }] : []),
    ...(fmtDate ? [{ label: "Valable jusqu'au", value: fmtDate }] : []),
  ]

  const body = `
<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:0.8px;">Devis${numHtml}</p>
<h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0a0a0a;line-height:1.3;">
  Bonjour${clientName ? ' ' + escHtml(clientName) : ''} !
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.7;">
  ${escHtml(orgName)} vous a transmis un devis${quoteTitle ? ' pour : <strong>' + escHtml(quoteTitle) + '</strong>' : ''}.
  Vous pouvez le consulter et l'accepter directement en cliquant sur le bouton ci-dessous.
</p>
${infoRows.length > 0 ? renderInfoBox(infoRows) : ''}
${renderCTA('Consulter &amp; signer le devis →', signUrl)}
<p style="margin:0;font-size:13px;color:#aaa;line-height:1.6;">
  Une question ? Répondez simplement à cet email ou contactez-nous à
  <a href="mailto:${escHtml(orgEmail)}" style="color:#555;">${escHtml(orgEmail)}</a>.
</p>
<p style="margin:14px 0 0;font-size:13px;color:#555;line-height:1.6;">
  Au plaisir de poursuivre ce projet avec vous.
</p>`

  const fallback = `
<p style="margin:0;font-size:11px;color:#ccc;">
  Lien alternatif :<br/>
  <a href="${signUrl}" style="color:#999;word-break:break-all;">${signUrl}</a>
</p>`

  const html = renderEmailShell({
    title: subject,
    headerName: orgName,
    bodyHtml: body,
    fallbackLinkHtml: fallback,
  })

  return { subject, html }
}

// ─── Confirmation client — devis accepté ──────────────────────────────────────

export function buildQuoteAcceptedClientEmail({
  orgName,
  clientName,
  quoteNumber,
  quoteTitle,
  totalTtc,
  currency,
  signedAt,
}: {
  orgName: string
  clientName: string
  quoteNumber: string | null
  quoteTitle: string | null
  totalTtc: number | null
  currency: string
  signedAt: Date
}): { subject: string; html: string } {
  const numText = quoteNumber ? ` N° ${quoteNumber}` : ''
  const subject = `Votre devis${numText} a bien été accepté · ${orgName}`
  const numHtml = quoteNumber ? ` N° ${escHtml(quoteNumber)}` : ''

  const fmtAmt = totalTtc != null
    ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(totalTtc)
    : null
  const fmtDateTime = signedAt.toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
  })

  const infoRows = [
    { label: 'Devis', value: escHtml(quoteNumber ?? '-') },
    ...(quoteTitle ? [{ label: 'Objet', value: escHtml(quoteTitle) }] : []),
    ...(fmtAmt ? [{ label: 'Montant TTC', value: fmtAmt, large: true }] : []),
    { label: 'Accepté le', value: fmtDateTime },
  ]

  const extraHeader = `
<div style="width:52px;height:52px;background:rgba(255,255,255,0.2);border-radius:50%;margin:0 auto 12px;text-align:center;line-height:52px;font-size:26px;">✓</div>`

  const body = `
<h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0a0a0a;line-height:1.3;">
  Votre accord a bien été enregistré !
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.7;">
  Bonjour ${escHtml(clientName)},<br/><br/>
  Nous confirmons que vous avez accepté le devis${numHtml}${quoteTitle ? ' : <strong>' + escHtml(quoteTitle) + '</strong>' : ''}
  le <strong>${fmtDateTime} (heure de Paris)</strong>.
</p>
${renderInfoBox(infoRows, 'success')}
<p style="margin:0;font-size:13px;color:#888;line-height:1.6;">
  Cet email vaut confirmation de votre accord. Conservez-le comme preuve d'acceptation.
  Merci encore pour votre confiance, ${escHtml(orgName)} reste à votre écoute pour la suite.
</p>`

  const html = renderEmailShell({
    title: subject,
    headerName: orgName,
    headerColor: '#16a34a',
    extraHeaderHtml: extraHeader,
    bodyHtml: body,
  })

  return { subject, html }
}

// ─── Export d'organisation prêt ───────────────────────────────────────────────

export function buildOrganizationExportReadyEmail({
  orgName,
  downloadUrl,
  expiresAt,
  summary,
}: {
  orgName: string
  downloadUrl: string
  expiresAt: string
  summary: {
    counts: Record<string, number>
    files: Record<string, number>
    warnings: string[]
  }
}): { subject: string; html: string } {
  const subject = `Votre export complet ${orgName} est pret`
  const formattedExpiry = new Date(expiresAt).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  })

  const infoRows = [
    { label: 'Organisation', value: escHtml(orgName) },
    { label: 'CSV exportes', value: String(Object.values(summary.counts).reduce((sum, count) => sum + count, 0)) },
    { label: 'Fichiers inclus', value: String(Object.values(summary.files).reduce((sum, count) => sum + count, 0)) },
    { label: 'Lien valide jusqu au', value: formattedExpiry, large: true },
  ]

  const warningHtml = summary.warnings.length > 0
    ? renderAlertBanner(
        `Quelques elements ont demande une attention manuelle : ${escHtml(summary.warnings.join(' | '))}`,
        'info',
      )
    : ''

  const body = `
<h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#0a0a0a;line-height:1.3;">
  Votre export complet est pret
</h1>
<p style="margin:0 0 26px;font-size:15px;color:#555;line-height:1.7;">
  L export de reversibilite de <strong>${escHtml(orgName)}</strong> vient d etre genere.
  Le lien ci-dessous permet de telecharger l archive ZIP securisee.
</p>
${renderInfoBox(infoRows)}
${warningHtml}
${renderCTA('Telecharger l export securise →', downloadUrl)}
${renderTextBox(
  'Cet export automatise ne declenche aucune suppression. La cloture et la suppression restent gerees separement, avec verification des obligations de conservation.',
)}
<p style="margin:18px 0 0;font-size:12px;color:#888;line-height:1.6;">
  Si le lien expire, reconnectez-vous a l app puis ouvrez Parametres > Donnees & confidentialite pour en regenerer un nouveau.
</p>`

  const fallback = `
<p style="margin:0;font-size:12px;color:#bbb;">
  Lien alternatif :<br/>
  <a href="${downloadUrl}" style="color:#555;word-break:break-all;">${downloadUrl}</a>
</p>`

  const html = renderEmailShell({
    title: subject,
    headerName: orgName,
    bodyHtml: body,
    fallbackLinkHtml: fallback,
  })

  return { subject, html }
}

// ─── Notification pro — devis accepté par le client ──────────────────────────

export function buildQuoteAcceptedProfessionalEmail({
  orgName,
  clientName,
  clientEmail,
  quoteNumber,
  quoteTitle,
  totalTtc,
  currency,
  signedAt,
  quoteEditorUrl,
}: {
  orgName: string
  clientName: string
  clientEmail: string
  quoteNumber: string | null
  quoteTitle: string | null
  totalTtc: number | null
  currency: string
  signedAt: Date
  quoteEditorUrl: string
}): { subject: string; html: string } {
  const numText = quoteNumber ? ` N° ${quoteNumber}` : ''
  const subject = `✅ ${clientName} a accepté le devis${numText}`
  const numHtml = quoteNumber ? ` N° ${escHtml(quoteNumber)}` : ''

  const fmtAmt = totalTtc != null
    ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(totalTtc)
    : null
  const fmtDateTime = signedAt.toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
  })

  const alert = renderAlertBanner(
    `<strong>${escHtml(clientName)}</strong> vient d'accepter votre devis${numHtml} !`,
    'success',
  )

  const infoRows = [
    { label: 'Client', value: `${escHtml(clientName)} &lt;${escHtml(clientEmail)}&gt;` },
    { label: 'Devis', value: `${escHtml(quoteNumber ?? '-')}${quoteTitle ? ' · ' + escHtml(quoteTitle) : ''}` },
    ...(fmtAmt ? [{ label: 'Montant TTC', value: fmtAmt, large: true }] : []),
    { label: 'Signé le', value: fmtDateTime },
  ]

  const body = `
<p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.7;">
  Bonne nouvelle ! Votre client a signé le devis le <strong>${fmtDateTime} (heure de Paris)</strong>.
  Vous pouvez maintenant préparer la suite de la mission.
</p>
${renderInfoBox(infoRows)}
${renderCTA(`Voir le devis dans ${APP_NAME} →`, quoteEditorUrl)}
<p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
  Le client a reçu un message personnalisé. Vous pouvez maintenant préparer la suite sereinement.
</p>`

  const html = renderEmailShell({
    title: subject,
    headerName: orgName,
    alertHtml: alert,
    bodyHtml: body,
  })

  return { subject, html }
}

// ─── Paiement reçu — confirmation client ─────────────────────────────────────

export function buildInvoicePaidEmail({
  orgName,
  orgEmail,
  clientName,
  invoiceNumber,
  invoiceTitle,
  totalTtc,
  currency,
  paidAt,
}: {
  orgName: string
  orgEmail: string
  clientName: string
  invoiceNumber: string | null
  invoiceTitle: string | null
  totalTtc: number | null
  currency: string
  paidAt: Date
}): { subject: string; html: string } {
  const subject = `Merci ${clientName ? clientName + ', votre ' : 'pour votre '}règlement a bien été reçu · ${orgName}`
  const numHtml = invoiceNumber ? ` N° ${escHtml(invoiceNumber)}` : ''

  const fmtAmt = totalTtc != null
    ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(totalTtc)
    : null
  const fmtDate = paidAt.toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  const infoRows = [
    { label: 'Facture', value: invoiceNumber ? escHtml(invoiceNumber) : '-' },
    ...(invoiceTitle ? [{ label: 'Objet', value: escHtml(invoiceTitle) }] : []),
    ...(fmtAmt ? [{ label: 'Montant réglé', value: fmtAmt, large: true }] : []),
    { label: 'Date de règlement', value: fmtDate },
  ]

  const body = `
<h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#0a0a0a;line-height:1.3;">
  Merci pour votre confiance
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.7;">
  Bonjour ${escHtml(clientName)},<br/><br/>
  Nous avons bien reçu votre règlement${numHtml ? ' de la facture' + numHtml : ''}${invoiceTitle ? ' (« ' + escHtml(invoiceTitle) + ' »)' : ''}.
  Merci pour votre ponctualité et votre confiance !<br/><br/>
  C'est un plaisir de travailler avec vous et nous espérons vous retrouver très bientôt pour de nouveaux projets.
</p>
${renderInfoBox(infoRows)}
<p style="margin:0;font-size:13px;color:#aaa;line-height:1.6;">
  Pour toute question, n'hésitez pas à nous contacter à
  <a href="mailto:${escHtml(orgEmail)}" style="color:#555;">${escHtml(orgEmail)}</a>.
</p>
<p style="margin:14px 0 0;font-size:13px;color:#555;line-height:1.6;">
  Au plaisir de continuer à travailler ensemble.
</p>`

  const html = renderEmailShell({
    title: subject,
    headerName: orgName,
    bodyHtml: body,
  })

  return { subject, html }
}

// ─── Facture d'acompte envoyée au client ─────────────────────────────────────

export function buildDepositInvoiceEmail({
  orgName,
  orgEmail,
  clientName,
  invoiceNumber,
  quoteNumber,
  quoteTitle,
  depositRate,
  totalTtc,
  currency,
  dueDate,
  pdfUrl,
}: {
  orgName: string
  orgEmail: string
  clientName: string
  invoiceNumber: string | null
  quoteNumber: string | null
  quoteTitle: string | null
  depositRate: number | null
  totalTtc: number | null
  currency: string
  dueDate: string | null
  pdfUrl: string
}): { subject: string; html: string } {
  const numText = invoiceNumber ? ` N° ${invoiceNumber}` : ''
  const subject = `Facture d'acompte${numText} · ${orgName}`
  const numHtml = invoiceNumber ? ` N° ${escHtml(invoiceNumber)}` : ''

  const fmtAmt = totalTtc != null
    ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(totalTtc)
    : null
  const fmtDue = dueDate
    ? new Date(dueDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    : null

  const depositLabel = depositRate ? `Acompte de ${depositRate}%` : 'Acompte'
  const quoteRef = quoteNumber
    ? ` sur votre devis N° ${escHtml(quoteNumber)}${quoteTitle ? ' (« ' + escHtml(quoteTitle) + ' »)' : ''}`
    : quoteTitle ? ` pour : <strong>${escHtml(quoteTitle)}</strong>` : ''

  const infoRows = [
    { label: 'Nature', value: depositLabel },
    ...(quoteNumber ? [{ label: 'Devis de référence', value: escHtml(quoteNumber) }] : []),
    ...(fmtAmt ? [{ label: 'Montant TTC', value: fmtAmt, large: true }] : []),
    ...(fmtDue ? [{ label: 'À régler avant le', value: `<strong>${fmtDue}</strong>` }] : []),
  ]

  const body = `
<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:0.8px;">Facture d'acompte${numHtml}</p>
<h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0a0a0a;line-height:1.3;">
  Bonjour${clientName ? ' ' + escHtml(clientName) : ''} !
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.7;">
  ${escHtml(orgName)} vous adresse une facture d'acompte${quoteRef}.
  Vous trouverez ci-dessous les détails et le document PDF en pièce jointe.
</p>
${renderInfoBox(infoRows)}
${renderCTA('Voir la facture PDF →', pdfUrl)}
<p style="margin:0;font-size:13px;color:#aaa;line-height:1.6;">
  Pour toute question, répondez simplement à cet email ou contactez-nous à
  <a href="mailto:${escHtml(orgEmail)}" style="color:#555;">${escHtml(orgEmail)}</a>.
</p>
<p style="margin:14px 0 0;font-size:13px;color:#555;line-height:1.6;">
  Merci pour votre confiance.
</p>`

  const fallback = `
<p style="margin:0;font-size:11px;color:#ccc;">
  Lien alternatif :<br/>
  <a href="${pdfUrl}" style="color:#999;word-break:break-all;">${pdfUrl}</a>
</p>`

  const html = renderEmailShell({
    title: subject,
    headerName: orgName,
    bodyHtml: body,
    fallbackLinkHtml: fallback,
  })

  return { subject, html }
}

// ─── Notification pro — nouvelle demande via formulaire public ────────────────

export function buildQuoteRequestNotificationEmail({
  orgName,
  name,
  email,
  phone,
  companyName,
  chantierAddress,
  description,
}: {
  orgName: string
  name: string
  email: string
  phone?: string | null
  companyName?: string | null
  chantierAddress?: string | null
  description: string
}): { subject: string; html: string } {
  const subject = `Nouvelle demande de devis : ${name}`

  const infoRows = [
    { label: 'Nom', value: escHtml(name) },
    { label: 'Email', value: `<a href="mailto:${escHtml(email)}" style="color:#555;">${escHtml(email)}</a>` },
    ...(phone ? [{ label: 'Téléphone', value: escHtml(phone) }] : []),
    ...(companyName ? [{ label: 'Entreprise', value: escHtml(companyName) }] : []),
    ...(chantierAddress ? [{ label: 'Chantier', value: escHtml(chantierAddress) }] : []),
  ]

  const body = `
<p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:0.8px;">Formulaire en ligne</p>
<h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0a0a0a;line-height:1.3;">
  Nouvelle demande de devis
</h1>
${renderInfoBox(infoRows)}
${renderTextBox(description, 'Message du client')}
<p style="margin:0;font-size:13px;color:#aaa;line-height:1.6;">
  Vous pouvez traiter cette demande quand vous êtes prêt, directement depuis ${APP_NAME}.
</p>`

  const html = renderEmailShell({
    title: subject,
    headerName: orgName,
    bodyHtml: body,
  })

  return { subject, html }
}
