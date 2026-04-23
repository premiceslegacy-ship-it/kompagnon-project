import { redirect } from 'next/navigation'

export default function InvoiceEditorLegacyRedirectPage({
  params,
}: {
  params: { id: string }
}) {
  redirect(`/finances/invoice-editor?id=${params.id}`)
}
