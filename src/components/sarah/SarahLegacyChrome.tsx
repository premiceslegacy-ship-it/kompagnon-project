'use client'

import { useEffect, useRef, useState, type ComponentType, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { ChevronRight, Eye, X } from 'lucide-react'

type SarahLegacyChromeProps = {
  Avatar: ComponentType<{ size: number }>
  open: boolean
  onOpen: () => void
  onOpenWithBrief: () => void
  onClose: () => void
  alertCount: number
  showBadge: boolean
  voiceMode: boolean
  highlightedActionId?: string | null
  children?: ReactNode
}

const BTN = 52
const PEEK = 14
const SNAP_KEY = 'sarah_snap'
const HIDDEN_KEY = 'sarah_hidden'

function defaultSnap(): 'left' | 'right' {
  if (typeof window === 'undefined') return 'right'
  return localStorage.getItem(SNAP_KEY) === 'left' ? 'left' : 'right'
}

export function SarahLegacyChrome({
  Avatar,
  open,
  onOpen,
  onOpenWithBrief,
  onClose,
  alertCount,
  showBadge,
  voiceMode,
  highlightedActionId,
  children,
}: SarahLegacyChromeProps) {
  const [isHidden, setIsHidden] = useState(false)
  const [snap, setSnap] = useState<'left' | 'right'>('right')
  const [peekOut, setPeekOut] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)
  const hasMoved = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const currentPos = useRef<{ x: number; y: number } | null>(null)
  const btnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSnap(defaultSnap())
    setIsHidden(localStorage.getItem(HIDDEN_KEY) === 'true')
    setIsMobile(window.innerWidth < 640)
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!highlightedActionId) return
    setIsHidden(false)
    setPeekOut(true)
    localStorage.setItem(HIDDEN_KEY, 'false')
  }, [highlightedActionId])

  useEffect(() => {
    if (open) setPeekOut(true)
  }, [open])

  useEffect(() => {
    const saved = localStorage.getItem('sarah_pos')
    if (!saved) return
    try {
      const { x, y } = JSON.parse(saved)
      const safeX = Math.max(8, Math.min(x, window.innerWidth - BTN - 8))
      const safeY = Math.max(8, Math.min(y, window.innerHeight - BTN - 8))
      setPos({ x: safeX, y: safeY })
      currentPos.current = { x: safeX, y: safeY }
    } catch {}
  }, [])

  useEffect(() => {
    const handleResize = () => {
      setPos(current => {
        if (!current) return null
        const safeX = Math.max(8, Math.min(current.x, window.innerWidth - BTN - 8))
        const safeY = Math.max(8, Math.min(current.y, window.innerHeight - BTN - 8))
        currentPos.current = { x: safeX, y: safeY }
        return { x: safeX, y: safeY }
      })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    dragging.current = true
    setIsDragging(true)
    hasMoved.current = false
    event.preventDefault()
  }

  useEffect(() => {
    function onMove(event: globalThis.PointerEvent) {
      if (!dragging.current) return
      hasMoved.current = true
      const x = event.clientX - dragOffset.current.x
      const y = event.clientY - dragOffset.current.y
      const safeX = Math.max(8, Math.min(x, window.innerWidth - BTN - 8))
      const safeY = Math.max(8, Math.min(y, window.innerHeight - BTN - 8))
      currentPos.current = { x: safeX, y: safeY }
      setPos({ x: safeX, y: safeY })
      setSnap(safeX + BTN / 2 < window.innerWidth / 2 ? 'left' : 'right')
    }

    function onUp() {
      if (!dragging.current) return
      dragging.current = false
      setIsDragging(false)
      if (!hasMoved.current || !currentPos.current) return
      localStorage.setItem('sarah_pos', JSON.stringify(currentPos.current))
      const nextSnap = currentPos.current.x + BTN / 2 < window.innerWidth / 2 ? 'left' : 'right'
      localStorage.setItem(SNAP_KEY, nextSnap)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  if (isHidden) {
    return (
      <button
        onClick={() => {
          setIsHidden(false)
          localStorage.setItem(HIDDEN_KEY, 'false')
        }}
        className="fixed bottom-4 right-4 z-[9970] flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs transition-all opacity-30 hover:opacity-80"
        style={{ background: 'var(--sarah-panel-bg)', border: '1px solid var(--sarah-panel-border)' }}
      >
        <Eye size={11} /> Sarah
      </button>
    )
  }

  const btnOffset = peekOut ? 0 : -(BTN - PEEK)
  const btnStyle: CSSProperties = isMobile ? {
    position: 'fixed', bottom: 84, right: 16, zIndex: 9970, width: BTN, height: BTN,
  } : {
    position: 'fixed',
    zIndex: 9970,
    width: BTN,
    height: BTN,
    transition: isDragging
      ? 'none'
      : 'right 0.32s cubic-bezier(0.34,1.56,0.64,1), left 0.32s cubic-bezier(0.34,1.56,0.64,1), top 0.32s cubic-bezier(0.34,1.56,0.64,1), bottom 0.32s cubic-bezier(0.34,1.56,0.64,1)',
    touchAction: 'none',
    ...(pos
      ? { left: pos.x, top: pos.y }
      : { bottom: 20, ...(snap === 'right' ? { right: btnOffset } : { left: btnOffset }) }),
  }

  const panelWidth = voiceMode ? 460 : 400
  const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight
  const panelHeight = voiceMode ? Math.min(700, viewportHeight - 80) : Math.min(620, viewportHeight - 80)
  const isRightHalf = pos && typeof window !== 'undefined'
    ? pos.x + BTN / 2 > window.innerWidth / 2
    : snap === 'right'
  const panelStyle: CSSProperties = isMobile ? {
    background: 'var(--sarah-panel-bg)',
    backdropFilter: 'blur(var(--sarah-panel-blur, 0px)) saturate(1.4)',
    WebkitBackdropFilter: 'blur(var(--sarah-panel-blur, 0px)) saturate(1.4)',
    border: '1px solid var(--sarah-panel-border)',
    boxShadow: 'var(--sarah-panel-shadow)',
    color: 'rgb(var(--text-primary))',
    height: '88dvh',
    borderRadius: '22px 22px 0 0',
    borderBottom: 'none',
  } : {
    background: 'var(--sarah-panel-bg)',
    backdropFilter: 'blur(var(--sarah-panel-blur, 0px)) saturate(1.4)',
    WebkitBackdropFilter: 'blur(var(--sarah-panel-blur, 0px)) saturate(1.4)',
    border: '1px solid var(--sarah-panel-border)',
    boxShadow: 'var(--sarah-panel-shadow)',
    color: 'rgb(var(--text-primary))',
    transition: 'width 0.35s cubic-bezier(0.34,1.56,0.64,1), height 0.35s cubic-bezier(0.34,1.56,0.64,1), right 0.35s ease, left 0.35s ease',
    width: panelWidth,
    height: panelHeight,
    bottom: 20,
    ...(isRightHalf
      ? { right: pos ? window.innerWidth - pos.x + 12 : BTN + 12 }
      : { left: pos ? pos.x + BTN + 12 : BTN + 12 }),
    borderRadius: 22,
  }

  return (
    <>
      {open && isMobile && (
        <div
          key="legacy-overlay"
          className="fixed inset-0 z-[9998]"
          onClick={onClose}
          style={{ background: 'rgba(0,0,0,0.4)' }}
        />
      )}
      {open && (
        <div
          key="legacy-panel"
          className={`fixed z-[9999] flex flex-col overflow-hidden${isMobile ? ' inset-x-0 bottom-0' : ''}`}
          style={panelStyle}
        >
          {isMobile && (
            <div key="legacy-handle" className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-9 h-1 rounded-full" style={{ background: 'rgba(128,128,128,0.3)' }} />
            </div>
          )}
          <div key="legacy-conversation" className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        </div>
      )}

      <div ref={btnRef} style={btnStyle} onPointerDown={isMobile ? undefined : onPointerDown}>
        {!isMobile && !peekOut && (
          <button
            className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95"
            style={{
              width: 22, height: 22,
              background: 'linear-gradient(to bottom, #ffb84d, rgb(255,159,28))',
              border: '1px solid rgba(255,255,255,0.15)',
              boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,0.45), 0 2px 0 0 #b45309, 0 2px 0 1px rgba(120,53,15,0.12), 0 4px 8px rgba(0,0,0,0.2)',
              ...(snap === 'right' ? { left: -28 } : { right: -28 }),
            }}
            onClick={() => setPeekOut(true)}
            title="Afficher Sarah"
          >
            <ChevronRight size={12} color="#000" style={{ transform: snap === 'right' ? 'none' : 'rotate(180deg)', filter: 'drop-shadow(0px 1px 0px rgba(255,255,255,0.24))' }} />
          </button>
        )}

        {!isMobile && (
          <button
            data-sarah-hide
            onClick={() => {
              setIsHidden(true)
              onClose()
              localStorage.setItem(HIDDEN_KEY, 'true')
            }}
            className="sarah-hide-btn absolute -top-1 z-10 w-4 h-4 rounded-full flex items-center justify-center"
            style={{
              background: 'var(--sarah-util-btn-bg)',
              border: '1px solid var(--sarah-util-btn-border)',
              boxShadow: 'var(--sarah-util-btn-shadow)',
              ...(snap === 'right' ? { left: -1 } : { right: -1 }),
            }}
            title="Masquer"
          >
            <X size={8} style={{ opacity: 0.55, filter: 'var(--sarah-icon-filter)' }} />
          </button>
        )}

        {!isMobile && peekOut && (
          <button
            className="sarah-hide-edge absolute z-10 w-4 h-4 rounded-full flex items-center justify-center"
            style={{
              background: 'var(--sarah-util-btn-bg)',
              border: '1px solid var(--sarah-util-btn-border)',
              boxShadow: 'var(--sarah-util-btn-shadow)',
              bottom: -1, ...(snap === 'right' ? { left: -1 } : { right: -1 }),
            }}
            onClick={event => {
              event.stopPropagation()
              setPeekOut(false)
              onClose()
              setPos(null)
              localStorage.removeItem('sarah_pos')
            }}
            title="Réduire sur le bord"
          >
            <ChevronRight size={8} style={{ opacity: 0.55, transform: snap === 'right' ? 'none' : 'rotate(180deg)', filter: 'var(--sarah-icon-filter)' }} />
          </button>
        )}

        <button
          onClick={() => {
            if (isMobile) {
              if (open) onClose()
              else onOpen()
              return
            }
            if (hasMoved.current) return
            if (!peekOut) { setPeekOut(true); return }
            if (open) onClose()
            else onOpen()
          }}
          aria-label={open ? 'Fermer Sarah' : 'Ouvrir Sarah'}
          className="w-full h-full rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
          style={{
            cursor: isMobile ? 'pointer' : 'grab',
            boxShadow: open
              ? 'inset 0 1.5px 0 rgba(255,255,255,0.25), 0 0 0 3px rgb(255,159,28), 0 4px 0 0 rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.35)'
              : 'inset 0 1.5px 0 rgba(255,255,255,0.25), 0 4px 0 0 rgba(0,0,0,0.3), 0 4px 0 1px rgba(0,0,0,0.1), 0 8px 20px rgba(0,0,0,0.25), 0 0 0 2px rgba(255,159,28,0.45)',
          }}
        >
          <Avatar size={BTN} />
        </button>

        {showBadge && (
          <button
            onClick={event => { event.stopPropagation(); onOpenWithBrief() }}
            className="absolute -top-1 -right-1 z-20 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white transition-transform hover:scale-110 active:scale-95"
            style={{ background: 'rgb(var(--danger))', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }}
          >
            {alertCount > 9 ? '9+' : alertCount}
          </button>
        )}
      </div>
    </>
  )
}
