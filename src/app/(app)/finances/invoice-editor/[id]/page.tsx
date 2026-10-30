import { redirect } from 'next/navigation'

export default async function InvoiceEditorLegacyRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/finances/invoice-editor?id=${id}`)
}
