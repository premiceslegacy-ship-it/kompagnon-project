import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { constantTimeEqual } from '@/lib/security'

// Token HMAC-SHA256 : orgId signé avec SUPABASE_SERVICE_ROLE_KEY (jamais exposée côté client)
async function computeToken(orgId: string): Promise<string> {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(orgId))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function formatIcalDate(date: string, time: string | null, allDay = false): string {
  if (allDay || !time) return date.replace(/-/g, '')
  const [h, m] = time.split(':')
  return `${date.replace(/-/g, '')}T${h.padStart(2, '0')}${(m ?? '00').padStart(2, '0')}00`
}

function escapeIcal(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function buildCalendarResponse(events: string[]): NextResponse {
  const calendar = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kompagnon//Planning Chantiers//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Planning Chantiers',
    'X-WR-TIMEZONE:Europe/Paris',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n')

  return new NextResponse(calendar, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="planning-chantiers.ics"',
      'Cache-Control': 'no-cache',
    },
  })
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const orgId = searchParams.get('orgId')
  const token = searchParams.get('token')

  if (!orgId || !token) {
    return new NextResponse('Missing parameters', { status: 400 })
  }

  const expected = await computeToken(orgId)
  if (!constantTimeEqual(token, expected)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const supabase = createAdminClient()

  // Récupérer les chantiers de l'organisation
  const { data: chantierRows } = await supabase
    .from('chantiers')
    .select('id, title')
    .eq('organization_id', orgId)
    .eq('is_archived', false)

  if (!chantierRows || chantierRows.length === 0) {
    return buildCalendarResponse([])
  }

  const chantierMap: Record<string, string> = {}
  for (const c of chantierRows) chantierMap[c.id] = c.title

  const { data: slots, error } = await supabase
    .from('chantier_plannings')
    .select('id, chantier_id, planned_date, start_time, end_time, label, team_size, notes')
    .in('chantier_id', chantierRows.map(c => c.id))
    .order('planned_date', { ascending: true })

  if (error) {
    return new NextResponse('Internal error', { status: 500 })
  }

  const uid_base = `planning-${orgId}`
  const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'

  const events = (slots ?? []).map((slot: any) => {
    const chantierTitle = chantierMap[slot.chantier_id] ?? 'Chantier'
    const summary = escapeIcal(`${slot.label} — ${chantierTitle}`)
    const allDay = !slot.start_time
    const dtstart = formatIcalDate(slot.planned_date, slot.start_time, allDay)
    const dtend = slot.end_time ? formatIcalDate(slot.planned_date, slot.end_time, false) : dtstart

    const descParts: string[] = []
    if (slot.team_size > 1) descParts.push(`${slot.team_size} personnes`)
    if (slot.notes) descParts.push(slot.notes)

    return [
      'BEGIN:VEVENT',
      `UID:${uid_base}-${slot.id}@kompagnon`,
      `DTSTAMP:${now}`,
      `DTSTART${allDay ? ';VALUE=DATE' : ''}:${dtstart}`,
      `DTEND${allDay ? ';VALUE=DATE' : ''}:${dtend}`,
      `SUMMARY:${summary}`,
      ...(descParts.length > 0 ? [`DESCRIPTION:${escapeIcal(descParts.join(' — '))}`] : []),
      'END:VEVENT',
    ].join('\r\n')
  })

  return buildCalendarResponse(events)
}
