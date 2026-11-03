'use client'

import * as React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Button } from './Button'
import { Sheet, useSheetDepth } from './Sheet'
import styles from './Menu.module.css'

export interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
  checked?: boolean
  icon?: React.ReactNode
}

export interface MenuProps {
  trigger: React.ReactElement
  items: readonly MenuItem[]
  title?: string
  className?: string
}

function isDesktopViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth >= 900
}

function subscribeViewport(onChange: () => void) {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

function serverDesktopViewport() {
  return false
}

function scrollOverflowWithKeyboard(event: React.KeyboardEvent<HTMLElement>) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
    || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
  const container = event.currentTarget
  if (container.scrollWidth <= container.clientWidth) return
  event.preventDefault()
  container.scrollBy({ left: event.key === 'ArrowRight' ? container.clientWidth : -container.clientWidth })
}

export function Menu({ trigger, items, title = 'Options', className }: MenuProps) {
  const sheetDepth = useSheetDepth()
  const desktop = React.useSyncExternalStore(subscribeViewport, isDesktopViewport, serverDesktopViewport)
  const [desktopOpen, setDesktopOpen] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const pendingSelectionRef = React.useRef<MenuItem | null>(null)

  const handleDesktopOpenChange = React.useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setDesktopOpen(false)
      setMobileOpen(false)
      return
    }

    if (mobileOpen) {
      setMobileOpen(false)
      return
    }

    if (sheetDepth >= 2 || isDesktopViewport()) {
      setDesktopOpen(true)
    } else {
      triggerRef.current?.focus({ preventScroll: true })
      setMobileOpen(true)
    }
  }, [mobileOpen, sheetDepth])

  const menuTrigger = React.cloneElement(trigger, {
    'aria-expanded': desktopOpen || mobileOpen,
    'aria-haspopup':
      desktopOpen || (!mobileOpen && (sheetDepth >= 2 || desktop)) ? 'menu' : 'dialog',
  } as React.HTMLAttributes<HTMLElement>)

  const selectDesktopItem = React.useCallback((item: MenuItem) => {
    if (item.disabled || pendingSelectionRef.current) return
    pendingSelectionRef.current = item
  }, [])

  const selectMobileItem = React.useCallback((item: MenuItem) => {
    if (item.disabled || pendingSelectionRef.current) return
    pendingSelectionRef.current = item
    setMobileOpen(false)
  }, [])

  const handleDesktopCloseAutoFocus = React.useCallback((event: Event) => {
    const selectedItem = pendingSelectionRef.current
    if (!selectedItem) return
    event.preventDefault()
    triggerRef.current?.focus({ preventScroll: true })
    pendingSelectionRef.current = null
    selectedItem.onSelect()
  }, [])

  const consumeMobileSelection = React.useCallback(() => {
    const selectedItem = pendingSelectionRef.current
    if (!selectedItem) return
    pendingSelectionRef.current = null
    selectedItem.onSelect()
  }, [])

  return (
    <DropdownMenu.Root open={desktopOpen} onOpenChange={handleDesktopOpenChange} modal>
      <DropdownMenu.Trigger ref={triggerRef} asChild>{menuTrigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={`${styles.content}${className ? ` ${className}` : ''}`}
          sideOffset={8}
          align="end"
          collisionPadding={8}
          onCloseAutoFocus={handleDesktopCloseAutoFocus}
          onKeyDown={scrollOverflowWithKeyboard}
        >
          {items.map((item) => {
            const itemContent = (
              <>
                <span className={styles.label}>{item.label}</span>
                {item.icon ? <span className={styles.icon} aria-hidden="true">{item.icon}</span> : null}
                {item.checked ? <DropdownMenu.ItemIndicator className={styles.indicator} aria-hidden="true">✓</DropdownMenu.ItemIndicator> : null}
              </>
            )

            if (item.checked !== undefined) {
              return (
                <DropdownMenu.CheckboxItem
                  key={item.label}
                  className={`${styles.item}${item.destructive ? ` ${styles.destructive}` : ''}`}
                  checked={item.checked}
                  disabled={item.disabled}
                  onSelect={() => selectDesktopItem(item)}
                >
                  {itemContent}
                </DropdownMenu.CheckboxItem>
              )
            }

            return (
              <DropdownMenu.Item
                key={item.label}
                className={`${styles.item}${item.destructive ? ` ${styles.destructive}` : ''}`}
                disabled={item.disabled}
                onSelect={() => selectDesktopItem(item)}
              >
                {itemContent}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen} onAfterClose={consumeMobileSelection} title={title}>
        <div className={styles.mobileItems} onKeyDown={scrollOverflowWithKeyboard}>
          {items.map((item) => (
            <Button
              key={item.label}
              type="button"
              variant="text"
              size="md"
              className={`${styles.mobileItem}${item.destructive ? ` ${styles.destructive}` : ''}`}
              disabled={item.disabled}
              aria-pressed={item.checked}
              onClick={() => selectMobileItem(item)}
            >
              <span className={styles.label}>{item.label}</span>
              {item.icon ? <span className={styles.icon} aria-hidden="true">{item.icon}</span> : null}
              {item.checked ? <span className={styles.indicator} aria-hidden="true">✓</span> : null}
            </Button>
          ))}
        </div>
      </Sheet>
    </DropdownMenu.Root>
  )
}

