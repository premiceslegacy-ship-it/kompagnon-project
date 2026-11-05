// @atelier-migrated
import {
  createLucideIcon, ClipboardSignature, Repeat2, CalendarDays, Inbox,
  MessageCircle, ReceiptText,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { NavigationIconName } from './navigation'

const Group = createLucideIcon('AtelierGroup', [
  ['circle', { cx: '9', cy: '8.200', r: '3.300', key: 'primary' }],
  ['circle', { cx: '17', cy: '7.600', r: '2.800', key: 'secondary' }],
  ['path', { d: 'M2.600 20.400c.300-3.400 2.900-5.500 6.400-5.500s6.100 2.100 6.400 5.500a.700.700 0 01-.700.700H3.300a.700.700 0 01-.700-.700zM17.600 13.200c2.400.400 4 2.200 4.200 4.900a.700.700 0 01-.700.700h-2.500', key: 'body' }],
])
const Box = createLucideIcon('AtelierBox', [
  ['path', { d: 'M3.8 13.2l2.6-7.1A2 2 0 0 1 8.3 4.8h7.4a2 2 0 0 1 1.9 1.3l2.6 7.1v4.4a2 2 0 0 1-2 2H5.8a2 2 0 0 1-2-2zM3.8 13.2h4.6l1.4 2.4h4.4l1.4-2.4h4.6', key: 'box' }],
])

const ICONS: Record<NavigationIconName, LucideIcon> = {
  home: createLucideIcon('AtelierHome', [
    ['path', { d: 'M3.200 11.400L12 3.600l8.800 7.800M5.400 9.800v9.200a1.600 1.600 0 001.600 1.600h10a1.600 1.600 0 001.600-1.600V9.800M10 20.600v-5.400a.800.800 0 01.800-.800h2.400a.800.800 0 01.800.800v5.400', key: 'home' }],
  ]),
  document: createLucideIcon('AtelierDocument', [
    ['path', { d: 'M7.800 2.800h5.400a2 2 0 011.420.580l3.800 3.800A2 2 0 0119 8.600v9.800a2.800 2.800 0 01-2.800 2.800H7.800A2.800 2.800 0 015 18.400V5.600a2.800 2.800 0 012.800-2.800zM8.600 12.400h6.800M8.600 16h6.800', key: 'document' }],
  ]),
  chantier: createLucideIcon('AtelierFolder', [
    ['path', { d: 'M3 8.200a2.800 2.800 0 012.800-2.800h3.300a2 2 0 011.500.680l1 1.120h6.600A2.800 2.800 0 0121 10v7.600a2.800 2.800 0 01-2.800 2.800H5.800A2.800 2.800 0 013 17.600zM3 10.800h18', key: 'folder' }],
  ]),
  clients: Group,
  company: Box,
  catalogue: Box,
  reports: createLucideIcon('AtelierReports', [
    ['rect', { x: '3.400', y: '12.200', width: '4.600', height: '8.400', rx: '1.600', key: 'first' }],
    ['rect', { x: '9.700', y: '8', width: '4.600', height: '12.600', rx: '1.600', key: 'second' }],
    ['rect', { x: '16', y: '3.600', width: '4.600', height: '17', rx: '1.600', key: 'third' }],
  ]),
  maintenance: createLucideIcon('AtelierMaintenance', [
    ['circle', { cx: '12', cy: '12', r: '3.200', key: 'center' }],
    ['path', { d: 'M12 2.900l1.500 2.300 2.700-.700.700 2.700 2.600.800-.800 2.600L20.700 12l-2 1.400.800 2.600-2.600.800-.700 2.700-2.700-.700L12 21.100l-1.500-2.300-2.700.700-.700-2.700-2.600-.800.800-2.600L3.300 12l2-1.400-.800-2.600 2.600-.800.700-2.700 2.700.700z', key: 'gear' }],
  ]),
  hours: createLucideIcon('AtelierClock', [
    ['circle', { cx: '12', cy: '12', r: '9', key: 'face' }],
    ['path', { d: 'M12 6.600V12h4.200', key: 'hands' }],
  ]),
  teams: Group,
  settings: createLucideIcon('AtelierSettings', [
    ['path', { d: 'M3.400 6.200h9.600M18.200 6.200h2.400M3.400 12h2.600M11.200 12h9.400M3.400 17.800h8M16.600 17.800h4', key: 'tracks' }],
    ['circle', { cx: '15.600', cy: '6.200', r: '2.500', key: 'first' }],
    ['circle', { cx: '8.600', cy: '12', r: '2.500', key: 'second' }],
    ['circle', { cx: '14', cy: '17.800', r: '2.500', key: 'third' }],
  ]),
  contracts: ClipboardSignature,
  recurring: Repeat2,
  planning: CalendarDays,
  requests: Inbox,
  assistant: MessageCircle,
  invoice: ReceiptText,
}

export function NavigationIcon({ name, className, size = 20 }: {
  name: NavigationIconName
  className?: string
  size?: number
}) {
  const Icon = ICONS[name]
  return <Icon className={className} size={size} strokeWidth={1.6} aria-hidden="true" />
}
