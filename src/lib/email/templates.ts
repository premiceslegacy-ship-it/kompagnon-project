/**
 * Templates HTML pour les emails applicatifs produit.
 * Emails envoyés via Resend avec le compte du client.
 * Tous basés sur renderEmailShell (src/lib/email/layout.ts).
 * Design system : Dark Liquid Glass
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

const H1 = `margin:0 0 12px;font-size:22px;font-weight:800;color:#FFFFFF;line-height:1.3;letter-spacing:-0.04em;font-family:'Plus Jakarta Sans',sans-serif;`
const BODY_P = `margin:0 0 28px;font-size:15px;color:#A1A1AA;line-height:1.6;font-family:'Inter',sans-serif;`
const SMALL_P = `margin:0;font-size:13px;color:#555555;line-height:1.5;font-family:'Inter',sans-serif;`
const LABEL_P = `margin:0 0 8px;font-size:12px;font-weight:700;color:#A1A1AA;text-transform:uppercase;letter-spacing:0.8px;font-family:'Inter',sans-serif;`

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
<h1 style="${H1}">
  ${escHtml(inviterName)} vous a invité à rejoindre l'équipe !
</h1>
<p style="${BODY_P}">
  Cliquez sur le bouton ci-dessous pour accepter l'invitation et créer votre compte.
</p>
${renderCTA(`Rejoindre ${escHtml(orgName)} →`, inviteUrl)}
<p style="${SMALL_P}">
  Ce lien est valable <strong style="color:#FFFFFF;">7 jours</strong>. Si vous n'attendiez pas cette invitation, ignorez simplement cet email.
</p>`

  const fallback = `
<p style="margin:0;font-size:12px;color:#444444;font-family:'Inter',sans-serif;">
  Lien alternatif :<br/>
  <a href="${inviteUrl}" style="color:#555555;word-break:break-all;">${inviteUrl}</a>
</p>`

  const html = renderEmailShell({
    title: subject,
    headerName: orgName,
    headerLogoUrl: absoluteBrandAssetUrl(wordmarkForTheme('dark')),
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
<h1 style="${H1}">
  Bienvenue chez ${escHtml(orgName)} !
</h1>
<p style="${BODY_P}">
  Votre espace de gestion est prêt. Saisissez le code ci-dessous pour confirmer votre adresse email et accéder à votre logiciel.
</p>
${renderCodeBlock(otp)}
<p style="${SMALL_P}">
  Ce code est valable <strong style="color:#FFFFFF;">1 heure</strong>. Si vous n'avez pas créé de compte, ignorez simplement cet email.
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
<h1 style="${H1}">
  Réinitialisez votre mot de passe
</h1>
<p style="${BODY_P}">
  Saisissez ce code sur la page de réinitialisation pour choisir un nouveau mot de passe.
</p>
${renderCodeBlock(otp)}
<p style="${SMALL_P}">
  Ce code est valable <strong style="color:#FFFFFF;">1 heure</strong>. Si vous n'avez pas demandé cette réinitialisation, ignorez cet email : votre mot de passe reste inchangé.
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
  emailSignature,
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
  emailSignature?: string | null
}): { subject: string; html: string } {
  const numText = quoteNumber ? ` N° ${quoteNumber}` : ''
  const subject = `Votre devis${numText} de ${orgName}`
  const numHtml = quoteNumber ? ` N° ${escHtml(quoteNumber)}` : ''

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
<p style="${LABEL_P}">Devis${numHtml}</p>
<h1 style="${H1}">
  Bonjour${clientName ? ' ' + escHtml(clientName) : ''} !
</h1>
<p style="${BODY_P}">
  ${escHtml(orgName)} vous a transmis un devis${quoteTitle ? ' pour : <strong style="color:#FFFFFF;">' + escHtml(quoteTitle) + '</strong>' : ''}.
  Vous pouvez le consulter et l'accepter directement en cliquant sur le bouton ci-dessous.
</p>
${infoRows.length > 0 ? renderInfoBox(infoRows) : ''}
${renderCTA('Consulter &amp; signer le devis →', signUrl)}
<p style="${SMALL_P}">
  Une question ? Répondez simplement à cet email ou contactez-nous à
  <a href="mailto:${escHtml(orgEmail)}" style="color:#FF9F1C;">${escHtml(orgEmail)}</a>.
</p>
<p style="margin:14px 0 0;font-size:13px;color:#A1A1AA;line-height:1.6;font-family:'Inter',sans-serif;">
  Au plaisir de poursuivre ce projet avec vous.
</p>
${emailSignature ? `<p style="margin:24px 0 0;font-size:13px;color:#A1A1AA;line-height:1.6;white-space:pre-line;font-family:'Inter',sans-serif;">${escHtml(emailSignature)}</p>` : ''}`

  const fallback = `
<p style="margin:0;font-size:11px;color:#444444;font-family:'Inter',sans-serif;">
  Lien alternatif :<br/>
  <a href="${signUrl}" style="color:#555555;word-break:break-all;">${signUrl}</a>
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
  const numHtml = quoteNumber ? ` N° ${escHtml(quoteNumber)}` : ''

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
<div style="width:52px;height:52px;background:rgba(255,255,255,0.15);border-radius:50%;margin:0 auto 12px;text-align:center;line-height:52px;font-size:26px;">✓</div>`

  const body = `
<h1 style="${H1}">
  Votre accord a bien été enregistré !
</h1>
<p style="${BODY_P}">
  Bonjour ${escHtml(clientName)},<br/><br/>
  Nous confirmons que vous avez accepté le devis${numHtml}${quoteTitle ? ' : <strong style="color:#FFFFFF;">' + escHtml(quoteTitle) + '</strong>' : ''}
  le <strong style="color:#FFFFFF;">${fmtDateTime} (heure de Paris)</strong>.
</p>
${renderInfoBox(infoRows, 'success')}
<p style="${SMALL_P}">
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
  const subject = `Votre export complet ${orgName} est prêt`
  const formattedExpiry = new Date(expiresAt).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  })

  const infoRows = [
    { label: 'Organisation', value: escHtml(orgName) },
    { label: 'CSV exportés', value: String(Object.values(summary.counts).reduce((sum, count) => sum + count, 0)) },
    { label: 'Fichiers inclus', value: String(Object.values(summary.files).reduce((sum, count) => sum + count, 0)) },
    { label: "Lien valide jusqu'au", value: formattedExpiry, large: true },
  ]

  const warningHtml = summary.warnings.length > 0
    ? renderAlertBanner(
        `Quelques éléments ont nécessité une attention manuelle : ${escHtml(summary.warnings.join(' | '))}`,
        'info',
      )
    : ''

  const body = `
<h1 style="${H1}">
  Votre export complet est prêt
</h1>
<p style="${BODY_P}">
  L'export de réversibilité de <strong style="color:#FFFFFF;">${escHtml(orgName)}</strong> vient d'être généré.
  Le lien ci-dessous permet de télécharger l'archive ZIP sécurisée.
</p>
${renderInfoBox(infoRows)}
${warningHtml}
${renderCTA("Télécharger l'export sécurisé →", downloadUrl)}
${renderTextBox(
  "Cet export automatisé ne déclenche aucune suppression. La clôture et la suppression restent gérées séparément, avec vérification des obligations de conservation.",
)}
<p style="margin:18px 0 0;font-size:12px;color:#555555;line-height:1.6;font-family:'Inter',sans-serif;">
  Si le lien expire, reconnectez-vous à l'application puis ouvrez Paramètres &gt; Données &amp; confidentialité pour en régénérer un nouveau.
</p>`

  const fallback = `
<p style="margin:0;font-size:12px;color:#444444;font-family:'Inter',sans-serif;">
  Lien alternatif :<br/>
  <a href="${downloadUrl}" style="color:#555555;word-break:break-all;">${downloadUrl}</a>
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
  const subject = `${clientName} a accepté le devis${numText}`
  const numHtml = quoteNumber ? ` N° ${escHtml(quoteNumber)}` : ''

  const fmtAmt = totalTtc != null
    ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(totalTtc)
    : null
  const fmtDateTime = signedAt.toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
  })

  const alert = renderAlertBanner(
    `<strong>${escHtml(clientName)}</strong> vient d'accepter votre devis${numHtml} !`,
    'success',
  )

  const infoRows = [
    { label: 'Client', value: `${escHtml(clientName)} &lt;${escHtml(clientEmail)}&gt;` },
    { label: 'Devis', value: `${escHtml(quoteNumber ?? '-')}${quoteTitle ? ' · ' + escHtml(quoteTitle) : ''}` },
    ...(fmtAmt ? [{ label: 'Montant TTC', value: fmtAmt, large: true }] : []),
    { label: 'Signé le', value: fmtDateTime },
  ]

  const body = `
<p style="${BODY_P}">
  Bonne nouvelle ! Votre client a signé le devis le <strong style="color:#FFFFFF;">${fmtDateTime} (heure de Paris)</strong>.
  Vous pouvez maintenant préparer la suite de la mission.
</p>
${renderInfoBox(infoRows)}
${renderCTA(`Voir le devis dans ${APP_NAME} →`, quoteEditorUrl)}
<p style="${SMALL_P}">
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
  emailSignature,
}: {
  orgName: string
  orgEmail: string
  clientName: string
  invoiceNumber: string | null
  invoiceTitle: string | null
  totalTtc: number | null
  currency: string
  paidAt: Date
  emailSignature?: string | null
}): { subject: string; html: string } {
  const subject = `Merci ${clientName ? clientName + ', votre ' : 'pour votre '}règlement a bien été reçu · ${orgName}`
  const numHtml = invoiceNumber ? ` N° ${escHtml(invoiceNumber)}` : ''

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
<h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#FFFFFF;line-height:1.3;letter-spacing:-0.04em;font-family:'Plus Jakarta Sans',sans-serif;">
  Merci pour votre confiance
</h1>
<p style="${BODY_P}">
  Bonjour ${escHtml(clientName)},<br/><br/>
  Nous avons bien reçu votre règlement${numHtml ? ' de la facture' + numHtml : ''}${invoiceTitle ? ' (« ' + escHtml(invoiceTitle) + ' »)' : ''}.
  Merci pour votre ponctualité et votre confiance !<br/><br/>
  C'est un plaisir de travailler avec vous et nous espérons vous retrouver très bientôt pour de nouveaux projets.
</p>
${renderInfoBox(infoRows)}
<p style="${SMALL_P}">
  Pour toute question, n'hésitez pas à nous contacter à
  <a href="mailto:${escHtml(orgEmail)}" style="color:#FF9F1C;">${escHtml(orgEmail)}</a>.
</p>
<p style="margin:14px 0 0;font-size:13px;color:#A1A1AA;line-height:1.6;font-family:'Inter',sans-serif;">
  Au plaisir de continuer à travailler ensemble.
</p>
${emailSignature ? `<p style="margin:24px 0 0;font-size:13px;color:#A1A1AA;line-height:1.6;white-space:pre-line;font-family:'Inter',sans-serif;">${escHtml(emailSignature)}</p>` : ''}`

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
  emailSignature,
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
  emailSignature?: string | null
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
    : quoteTitle ? ` pour : <strong style="color:#FFFFFF;">${escHtml(quoteTitle)}</strong>` : ''

  const infoRows = [
    { label: 'Nature', value: depositLabel },
    ...(quoteNumber ? [{ label: 'Devis de référence', value: escHtml(quoteNumber) }] : []),
    ...(fmtAmt ? [{ label: 'Montant TTC', value: fmtAmt, large: true }] : []),
    ...(fmtDue ? [{ label: 'À régler avant le', value: `<strong style="color:#FFFFFF;">${fmtDue}</strong>` }] : []),
  ]

  const body = `
<p style="${LABEL_P}">Facture d'acompte${numHtml}</p>
<h1 style="${H1}">
  Bonjour${clientName ? ' ' + escHtml(clientName) : ''} !
</h1>
<p style="${BODY_P}">
  ${escHtml(orgName)} vous adresse une facture d'acompte${quoteRef}.
  Vous trouverez le document en pièce jointe. Merci de procéder au règlement avant la date indiquée.
</p>
${renderInfoBox(infoRows)}
<p style="${SMALL_P}">
  Pour toute question, répondez simplement à cet email ou contactez-nous à
  <a href="mailto:${escHtml(orgEmail)}" style="color:#FF9F1C;">${escHtml(orgEmail)}</a>.
</p>
<p style="margin:14px 0 0;font-size:13px;color:#A1A1AA;line-height:1.6;font-family:'Inter',sans-serif;">
  Merci pour votre confiance.
</p>
${emailSignature ? `<p style="margin:24px 0 0;font-size:13px;color:#A1A1AA;line-height:1.6;white-space:pre-line;font-family:'Inter',sans-serif;">${escHtml(emailSignature)}</p>` : ''}`

  const html = renderEmailShell({
    title: subject,
    headerName: orgName,
    bodyHtml: body,
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
    { label: 'Email', value: `<a href="mailto:${escHtml(email)}" style="color:#FF9F1C;">${escHtml(email)}</a>` },
    ...(phone ? [{ label: 'Téléphone', value: escHtml(phone) }] : []),
    ...(companyName ? [{ label: 'Entreprise', value: escHtml(companyName) }] : []),
    ...(chantierAddress ? [{ label: 'Chantier', value: escHtml(chantierAddress) }] : []),
  ]

  const body = `
<p style="${LABEL_P}">Formulaire en ligne</p>
<h1 style="${H1}">
  Nouvelle demande de devis
</h1>
${renderInfoBox(infoRows)}
${renderTextBox(description, 'Message du client')}
<p style="${SMALL_P}">
  Vous pouvez traiter cette demande quand vous êtes prêt, directement depuis ${APP_NAME}.
</p>`

  const html = renderEmailShell({
    title: subject,
    headerName: orgName,
    bodyHtml: body,
  })

  return { subject, html }
}

// ─── Espace membre — invitation au lien magique ───────────────────────────────

export function buildMemberSpaceInviteEmail({
  orgName,
  memberFirstName,
  spaceUrl,
}: {
  orgName: string
  memberFirstName: string | null
  spaceUrl: string
}): { subject: string; html: string } {
  const subject = `Accédez à votre espace ${orgName} — vos heures et créneaux`

  const greeting = memberFirstName ? `Bonjour ${escHtml(memberFirstName)},` : 'Bonjour,'

  const body = `
<h1 style="${H1}">
  Votre espace personnel est prêt
</h1>
<p style="margin:0 0 16px;font-size:15px;color:#A1A1AA;line-height:1.6;font-family:'Inter',sans-serif;">
  ${greeting}
</p>
<p style="${BODY_P}">
  ${escHtml(orgName)} vous donne accès à un espace dédié pour consulter vos créneaux planifiés, pointer vos heures et télécharger votre rapport mensuel.
</p>
${renderCTA('Ouvrir mon espace →', spaceUrl)}
<p style="${SMALL_P}">
  Ce lien est valable <strong style="color:#FFFFFF;">30 jours</strong>. Vous pourrez en redemander un nouveau à tout moment depuis la page d'accès.
</p>`

  const fallback = `
<p style="margin:0;font-size:12px;color:#444444;font-family:'Inter',sans-serif;">
  Lien alternatif :<br/>
  <a href="${spaceUrl}" style="color:#555555;word-break:break-all;">${spaceUrl}</a>
</p>`

  const html = renderEmailShell({
    title: subject,
    headerName: orgName,
    bodyHtml: body,
    fallbackLinkHtml: fallback,
  })

  return { subject, html }
}

// ─── Rapport mensuel d'heures (membre individuel) ─────────────────────────────

export function buildMemberMonthlyReportEmail({
  orgName,
  memberFirstName,
  periodLabel,
  totalHours,
  spaceUrl,
}: {
  orgName: string
  memberFirstName: string | null
  periodLabel: string
  totalHours: number
  spaceUrl: string | null
}): { subject: string; html: string } {
  const subject = `Votre rapport d'heures — ${periodLabel}`

  const greeting = memberFirstName ? `Bonjour ${escHtml(memberFirstName)},` : 'Bonjour,'

  const body = `
<h1 style="${H1}">
  Votre rapport d'heures de ${escHtml(periodLabel)}
</h1>
<p style="margin:0 0 16px;font-size:15px;color:#A1A1AA;line-height:1.6;font-family:'Inter',sans-serif;">
  ${greeting}
</p>
<p style="${BODY_P}">
  Veuillez trouver ci-joint le récapitulatif de vos heures pointées sur la période, soit <strong style="color:#FFFFFF;">${totalHours.toFixed(1)} h</strong> au total. Le détail par chantier et par jour est disponible dans le PDF joint.
</p>
${spaceUrl ? renderCTA('Voir mon espace →', spaceUrl) : ''}
<p style="${SMALL_P}">
  Pour toute question concernant ce rapport, contactez directement ${escHtml(orgName)}.
</p>`

  const html = renderEmailShell({
    title: subject,
    headerName: orgName,
    bodyHtml: body,
  })

  return { subject, html }
}
