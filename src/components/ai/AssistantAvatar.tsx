'use client'
import { Bot } from 'lucide-react'
import { AI_ASSISTANTS } from '@/lib/brand'

type AssistantKey = keyof typeof AI_ASSISTANTS

interface Props {
  assistant: AssistantKey
  size?: number        // px, défaut 32
  className?: string
}

export function AssistantAvatar({ assistant, size = 32, className = '' }: Props) {
  const { avatar, name } = AI_ASSISTANTS[assistant]

  const containerStyle = {
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
  }

  if (avatar) {
    return (
      <div
        className={`rounded-xl overflow-hidden bg-surface border border-[var(--elevation-border)] shadow-sm flex items-center justify-center flex-shrink-0 ${className}`}
        style={containerStyle}
      >
        <img
          src={avatar}
          alt={name}
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>
    )
  }

  // Fallback robot si pas d'avatar
  return (
    <div
      className={`rounded-xl bg-[var(--accent-primary)]/10 border border-[var(--elevation-border)] flex items-center justify-center flex-shrink-0 ${className}`}
      style={containerStyle}
    >
      <Bot
        className="text-[var(--accent-primary)]"
        style={{ width: size * 0.5, height: size * 0.5 }}
      />
    </div>
  )
}
