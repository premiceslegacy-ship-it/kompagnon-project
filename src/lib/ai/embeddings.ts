const EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b'
const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings'

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch(OPENROUTER_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
        'X-Title': process.env.NEXT_PUBLIC_APP_NAME ?? 'ATELIER',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.data?.[0]?.embedding ?? null
  } catch {
    return null
  }
}
