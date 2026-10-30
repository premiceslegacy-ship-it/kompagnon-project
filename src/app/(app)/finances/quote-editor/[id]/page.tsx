import { redirect } from 'next/navigation'

export default async function QuoteEditorLegacyRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/finances/quote-editor?id=${id}`)
}
