import { callAI } from '@/lib/ai/callAI'
import type { ModelCall } from '@/lib/ai/official-rule-check'

const VERIFIER_MODEL = 'google/gemini-2.5-flash'

export function makeOfficialRuleModelCall(organizationId: string): ModelCall {
  return async ({ messages, plugins, maxTokens }) => {
    const result = await callAI<{ choices?: Array<{ message?: { content?: string; annotations?: unknown[] } }> }>({
      organizationId,
      provider: 'openrouter',
      feature: 'sarah_assistant',
      model: VERIFIER_MODEL,
      inputKind: 'text',
      request: {
        timeoutMs: 45_000,
        body: { messages, temperature: 0, max_tokens: maxTokens, ...(plugins ? { plugins } : {}) },
      },
      metadata: { route: 'lib/ai/official-rule-check' },
    })
    const message = result.data?.choices?.[0]?.message
    return { content: message?.content ?? '', annotations: message?.annotations ?? [] }
  }
}
