import { NextRequest, NextResponse } from 'next/server'
import { getMemberPlannings } from '@/lib/data/queries/members'
import { constantTimeEqual } from '@/lib/security'
import { computeMemberIcalToken } from '@/lib/auth/member-ical-token'

function formatIcalDate(date: string, time: string | null): string {
  if (!time) return date.replace(/-/g, '')
  const [h, m] = time.split(':')
  return `${date.replace(/-/g, '')}T${h.padStart(2, '0')}${(m ?? '00').padStart(2, '0')}00`
}

function escapeIcal(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const memberId = searchParams.get('memberId')
  const token = searchParams.get('token')

  if (!memberId || !token) {
    return new NextResponse('Missing parameters', { status: 400 })
  }

  const expected = await computeMemberIcalToken(memberId)
  if (!constantTimeEqual(token, expected)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // 3 prochains mois
  const now = new Date()
  const dateFrom = now.toISOString().slice(0, 10)
  const dateTo = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString().slice(0, 10)

  const plannings = await getMemberPlannings(memberId, { dateFrom, dateTo, useAdmin: true })

  const nowStamp = now.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'

  const events = plannings.map(p => {
    const allDay = !p.start_time
    const dtstart = formatIcalDate(p.planned_date, p.start_time)
    const dtend = p.end_time ? formatIcalDate(p.planned_date, p.end_time) : dtstart
    const summary = escapeIcal(`${p.label} - ${p.chantier_title}`)
    const addr = [p.chantier_address_line1, p.chantier_postal_code, p.chantier_city].filter(Boolean).join(', ')
    const descParts: string[] = []
    if (addr) descParts.push(addr)
    if (p.notes) descParts.push(p.notes)

    return [
      'BEGIN:VEVENT',
      `UID:member-${memberId}-${p.id}@kompagnon`,
      `DTSTAMP:${nowStamp}`,
      `DTSTART${allDay ? ';VALUE=DATE' : ''}:${dtstart}`,
      `DTEND${allDay ? ';VALUE=DATE' : ''}:${dtend}`,
      `SUMMARY:${summary}`,
      ...(addr ? [`LOCATION:${escapeIcal(addr)}`] : []),
      ...(descParts.length > 0 ? [`DESCRIPTION:${escapeIcal(descParts.join(' - '))}`] : []),
      'END:VEVENT',
    ].join('\r\n')
  })

  const calendar = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kompagnon//Planning Membre//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Mon planning',
    'X-WR-TIMEZONE:Europe/Paris',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n')

  return new NextResponse(calendar, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="mon-planning.ics"',
      'Cache-Control': 'no-cache',
    },
  })
}
