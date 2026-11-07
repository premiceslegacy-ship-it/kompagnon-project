'use client'
// @atelier-migrated

import { cloneElement, useCallback, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Sheet } from '@/components/ui/Sheet'
import menuStyles from '@/components/ui/Menu.module.css'
import sheetStyles from '@/components/ui/Sheet.module.css'
import styles from './NavigationCommands.module.css'

export type NavigationMenuSelect = (action: () => void) => void

type NavigationMenuProps = {
  trigger: ReactElement
  desktop: boolean
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  children: (select: NavigationMenuSelect) => ReactNode
}


export function NavigationMenu({ desktop, trigger, open, onOpenChange, title, children }: NavigationMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const [pendingSelection, setPendingSelection] = useState<{ action: () => void; desktop: boolean } | null>(null)

  const visibleTrigger = useCallback(() => {
    const original = triggerRef.current
    if (original && original.getClientRects().length > 0) return original
    for (const candidate of document.querySelectorAll<HTMLButtonElement>('[data-navigation-menu]')) {
      if (candidate.dataset.navigationMenu === title && candidate.getClientRects().length > 0) return candidate
    }
    if (title === 'Profil') {
      const companyEntry = document.querySelector<HTMLAnchorElement>('[data-navigation-profile-entry]')
      if (companyEntry && companyEntry.getClientRects().length > 0) return companyEntry
    }
    return null
  }, [title])

  const positionContent = useCallback((content: HTMLDivElement) => {
    const anchor = visibleTrigger()
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const width = content.offsetWidth
    const height = content.offsetHeight
    const above = height > window.innerHeight - rect.bottom - 16 && rect.top > window.innerHeight - rect.bottom
    const top = Math.max(8, Math.min(above ? rect.top - height - 8 : rect.bottom + 8, window.innerHeight - height - 8))
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
    content.style.top = `${top}px`
    content.style.left = `${left}px`
    content.style.transformOrigin = above ? 'bottom right' : 'top right'
  }, [visibleTrigger])

  const attachContent = useCallback((element: HTMLDivElement | null) => {
    setContent(element)
    if (element) positionContent(element)
  }, [positionContent])

  useLayoutEffect(() => {
    if (!desktop || !open || !content) return
    const update = () => positionContent(content)
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && content.contains(event.target)) return
      update()
    }
    const observer = new ResizeObserver(update)
    observer.observe(content)
    const anchor = visibleTrigger()
    if (anchor) observer.observe(anchor)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [content, desktop, open, positionContent, visibleTrigger])

  const select = useCallback((action: () => void) => {
    setPendingSelection(current => current ?? { action, desktop })
    onOpenChange(false)
  }, [desktop, onOpenChange])

  const consumeSelection = useCallback((closedDesktop: boolean) => {
    if (open || (pendingSelection && pendingSelection.desktop !== closedDesktop)) return
    visibleTrigger()?.focus({ preventScroll: true })
    setPendingSelection(null)
    pendingSelection?.action()
  }, [open, pendingSelection, visibleTrigger])

  const handleDesktopCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault()
    consumeSelection(true)
  }, [consumeSelection])

  const menuTrigger = cloneElement(trigger, {
    'aria-expanded': open,
    'aria-haspopup': 'dialog',
    'aria-controls': undefined,
    'data-navigation-menu': title,
  } as HTMLAttributes<HTMLElement>)
  const menuBody = children(select)

  return (
    <Dialog.Root open={desktop && open} onOpenChange={onOpenChange} modal>
      <Dialog.Trigger ref={triggerRef} asChild>{menuTrigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.menuOverlay} />
        <Dialog.Content
          ref={attachContent}
          className={`${menuStyles.content} ${styles.menuContent}`}
          aria-describedby={undefined}
          onCloseAutoFocus={handleDesktopCloseAutoFocus}
          inert={pendingSelection !== null}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {menuBody}
        </Dialog.Content>
      </Dialog.Portal>
      <Sheet open={!desktop && open} onOpenChange={onOpenChange} title={title} onAfterClose={() => consumeSelection(false)}>
        <div className={`${sheetStyles.body} ${styles.sheetBody}`} inert={pendingSelection !== null}>{menuBody}</div>
      </Sheet>
    </Dialog.Root>
  )
}
