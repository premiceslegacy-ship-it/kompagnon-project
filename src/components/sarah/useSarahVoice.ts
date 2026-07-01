'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Conversation } from '@elevenlabs/react'
import type { Status, Mode } from '@elevenlabs/react'

export type VoiceLiveState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'muted'
  | 'disconnecting'
  | 'error'

export type VoiceLiveError =
  | 'quota_exceeded'
  | 'mic_denied'
  | 'network'
  | 'configuration'
  | 'module_disabled'
  | 'permission_denied'
  | 'server_error'

const MAX_SESSION_MS = 10 * 60 * 1000  // 10 min — coupure auto
const INACTIVITY_MS  = 3 * 60 * 1000  // 3 min sans parole → alerte, pas coupure forcée

type SarahVoiceOptions = {
  pageLabel?: string | null
  pathname?: string | null
  userName?: string | null
}

type VoiceActionToolParams = {
  type?: string
  title?: string
  label?: string
  description?: string
  risk?: 'low' | 'medium' | 'high'
  payload?: Record<string, unknown>
  deepLink?: string
  deep_link?: string
  dedupeKey?: string
  dedupe_key?: string
}

function signedUrlEndpoint(options: SarahVoiceOptions): string {
  const params = new URLSearchParams()
  if (options.pageLabel) params.set('page', options.pageLabel)
  if (options.pathname) params.set('pathname', options.pathname)
  if (options.userName) params.set('userName', options.userName)
  const qs = params.toString()
  return qs ? `/api/ai/elevenlabs/signed-url?${qs}` : '/api/ai/elevenlabs/signed-url'
}

export function useSarahVoice(options: SarahVoiceOptions = {}) {
  const { pageLabel = null, pathname = null, userName = null } = options
  const [voiceState, setVoiceState] = useState<VoiceLiveState>('idle')
  const [error, setError]           = useState<VoiceLiveError | null>(null)
  const [isMuted, setIsMuted]       = useState(false)
  const [elapsedSeconds, setElapsed]    = useState(0)
  const [remainingMinutes, setRemaining] = useState<number | null>(null)

  const conversationRef  = useRef<Awaited<ReturnType<typeof Conversation.startSession>> | null>(null)
  const sessionStartRef  = useRef<number | null>(null)
  const elapsedInterval  = useRef<ReturnType<typeof setInterval> | null>(null)
  const maxSessionTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRef        = useRef(false)
  const endingRef        = useRef(false)

  // Token pré-fetché au montage pour contourner Safari iOS getUserMedia.
  // Au démarrage réel on refetch quand même un contexte frais, car le planning/les pointages
  // peuvent changer entre l'ouverture de l'écran vocal et le début de conversation.
  const prefetchedRef = useRef<{ signed_url: string; system_prompt: string; remaining_minutes: number | null } | null>(null)
  const prefetchingRef = useRef(false)

  const prefetchToken = useCallback(async () => {
    if (prefetchingRef.current || prefetchedRef.current) return
    prefetchingRef.current = true
    try {
      const res = await fetch(signedUrlEndpoint({ pageLabel, pathname, userName }))
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const code = data?.code as string | undefined
        console.error('[SarahVoice] signed-url prefetch failed:', res.status, code ?? data?.error)
        setError(
          code === 'quota_exceeded' ? 'quota_exceeded' :
          code === 'permission_denied' ? 'permission_denied' :
          code === 'module_disabled' ? 'module_disabled' :
          code === 'elevenlabs_configuration' ? 'configuration' :
          'server_error',
        )
        return
      }
      const data = await res.json()
      prefetchedRef.current = data
    } catch (err) {
      console.error('[SarahVoice] signed-url prefetch error:', err)
    } finally {
      prefetchingRef.current = false
    }
  }, [pageLabel, pathname, userName])

  // Pré-fetch dès le montage du hook (quand VoiceScreen est affiché)
  useEffect(() => {
    prefetchToken()
  }, [prefetchToken])

  const clearTimers = useCallback(() => {
    if (elapsedInterval.current)  { clearInterval(elapsedInterval.current);  elapsedInterval.current = null }
    if (maxSessionTimer.current)  { clearTimeout(maxSessionTimer.current);   maxSessionTimer.current = null }
  }, [])

  const reportSessionEnd = useCallback(async (durationSeconds: number) => {
    if (durationSeconds <= 0) return
    try {
      await fetch('/api/ai/elevenlabs/session-end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_seconds: durationSeconds }),
      })
    } catch {
      // non bloquant
    }
  }, [])

  const stopSession = useCallback(async (reason: 'user' | 'timeout' | 'error' = 'user') => {
    if (!activeRef.current) return
    activeRef.current = false
    endingRef.current = true
    setVoiceState('disconnecting')
    clearTimers()

    const durationSeconds = sessionStartRef.current
      ? Math.round((Date.now() - sessionStartRef.current) / 1000)
      : 0

    try {
      await conversationRef.current?.endSession()
    } catch { /* ignore */ }
    conversationRef.current = null
    sessionStartRef.current = null

    await reportSessionEnd(durationSeconds)

    setElapsed(0)
    setIsMuted(false)
    setVoiceState(reason === 'error' ? 'error' : 'idle')
    // Invalider le token pré-fetché — il a été consommé ou est périmé
    prefetchedRef.current = null
  }, [clearTimers, reportSessionEnd])

  // Cleanup au démontage du composant
  useEffect(() => {
    return () => {
      if (activeRef.current) {
        stopSession('user')
      }
    }
  }, [stopSession])

  const startSession = useCallback(async () => {
    if (activeRef.current) return
    setError(null)
    setVoiceState('connecting')
    endingRef.current = false

    let tokenData: { signed_url: string; system_prompt: string; remaining_minutes: number | null } | null = null

    try {
      const res = await fetch(signedUrlEndpoint({ pageLabel, pathname, userName }))
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const code = data?.code as string | undefined
        setError(
          code === 'quota_exceeded' ? 'quota_exceeded' :
          code === 'permission_denied' ? 'permission_denied' :
          code === 'module_disabled' ? 'module_disabled' :
          code === 'elevenlabs_configuration' ? 'configuration' :
          'server_error',
        )
        setVoiceState('error')
        return
      }
      tokenData = await res.json()
    } catch {
      tokenData = prefetchedRef.current
      if (!tokenData) {
        setError('network')
        setVoiceState('error')
        return
      }
    }

    prefetchedRef.current = null
    setRemaining(tokenData!.remaining_minutes ?? null)

    try {
      const conversation = await Conversation.startSession({
        signedUrl: tokenData!.signed_url,
        overrides: {
          agent: {
            prompt: { prompt: tokenData!.system_prompt },
          },
        },
        clientTools: {
          create_sarah_action: async (params: VoiceActionToolParams) => {
            const type = typeof params.type === 'string' && params.type.trim() ? params.type.trim() : 'open_url'
            const title = typeof params.title === 'string' && params.title.trim()
              ? params.title.trim()
              : typeof params.label === 'string' && params.label.trim()
                ? params.label.trim()
                : 'Action Sarah'
            const description = typeof params.description === 'string' && params.description.trim()
              ? params.description.trim()
              : title
            const res = await fetch('/api/sarah/actions/propose', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type,
                title,
                description,
                risk: params.risk ?? 'low',
                payload: params.payload ?? {},
                deepLink: params.deepLink ?? params.deep_link ?? null,
                dedupeKey: params.dedupeKey ?? params.dedupe_key ?? `voice:${Date.now()}:${type}:${title.slice(0, 32)}`,
              }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data.action?.id) {
              return "Je n'ai pas réussi à préparer la carte d'action. Dites à l'utilisateur que le mode texte pourra le faire."
            }
            window.dispatchEvent(new CustomEvent('sarah-actions-updated', { detail: { actionId: data.action.id } }))
            return "Carte d'action Sarah préparée. Dites à l'utilisateur qu'elle l'attend dans Sarah pour validation."
          },
        },
        onStatusChange: ({ status }: { status: Status }) => {
          if (status === 'connected') {
            activeRef.current = true
            sessionStartRef.current = Date.now()
            setVoiceState('listening')

            elapsedInterval.current = setInterval(() => {
              setElapsed(Math.round((Date.now() - sessionStartRef.current!) / 1000))
            }, 1000)

            maxSessionTimer.current = setTimeout(() => {
              stopSession('timeout')
            }, MAX_SESSION_MS)
          }
          if (status === 'disconnected' || status === 'disconnecting') {
            if (endingRef.current) return
            if (activeRef.current) {
              stopSession('user')
              return
            }
            if (status === 'disconnected') {
              setError(prev => prev ?? 'configuration')
              setVoiceState('error')
            }
          }
        },
        onModeChange: ({ mode }: { mode: Mode }) => {
          if (!activeRef.current) return
          setVoiceState(prev => {
            if (prev === 'muted') return 'muted'
            return mode === 'speaking' ? 'speaking' : 'listening'
          })
        },
        onError: (message: string) => {
          console.error('[SarahVoice] ElevenLabs session error:', message)
          const lower = message.toLowerCase()
          setError(
            lower.includes('override') ||
            lower.includes('agent') ||
            lower.includes('voice') ||
            lower.includes('signed')
              ? 'configuration'
              : 'network',
          )
          setVoiceState('error')
          stopSession('error')
        },
      })

      conversationRef.current = conversation
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      console.error('[SarahVoice] ElevenLabs startSession failed:', err)
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('notallowed')) {
        setError('mic_denied')
      } else if (
        msg.toLowerCase().includes('override') ||
        msg.toLowerCase().includes('agent') ||
        msg.toLowerCase().includes('voice') ||
        msg.toLowerCase().includes('signed')
      ) {
        setError('configuration')
      } else {
        setError('network')
      }
      setVoiceState('error')
      activeRef.current = false
      prefetchedRef.current = null
    }
  }, [pageLabel, pathname, stopSession, userName])

  const toggleMute = useCallback(() => {
    if (!conversationRef.current || !activeRef.current) return
    const nextMuted = !isMuted
    conversationRef.current.setMicMuted(nextMuted)
    setIsMuted(nextMuted)
    setVoiceState(nextMuted ? 'muted' : 'listening')
  }, [isMuted])

  return {
    voiceState,
    error,
    isMuted,
    elapsedSeconds,
    remainingMinutes,
    startSession,
    stopSession: () => stopSession('user'),
    toggleMute,
  }
}
