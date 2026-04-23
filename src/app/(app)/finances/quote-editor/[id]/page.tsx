import { redirect } from 'next/navigation'

export default function QuoteEditorLegacyRedirectPage({
  params,
}: {
  params: { id: string }
}) {
  redirect(`/finances/quote-editor?id=${params.id}`)
}
