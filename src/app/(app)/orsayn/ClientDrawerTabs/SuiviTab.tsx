'use client'

import {
  formatDate,
  formatMoney,
  formatQuotaValue,
  getCommercialEventLabel,
  getEventLabel,
  getQuotaBadgeClass,
  normalizeNumber,
} from '../utils'
import type { ClientRow } from '../types'
import { QUOTA_DEFINITIONS } from '@/lib/quota-catalog'

const sectionTitleCls = 'text-sm font-bold uppercase tracking-wide text-secondary font-display'

export default function SuiviTab({ row }: { row: ClientRow }) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="card px-6 py-5 space-y-3">
        <p className={sectionTitleCls}>Quotas du mois en cours</p>
        {row.quotas.length === 0 ? (
          <p className="text-sm text-secondary">Aucun quota initialisé.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {row.quotas.map((quota) => {
              const definition = QUOTA_DEFINITIONS[quota.quota_feature]
              const current = normalizeNumber(quota.current_quantity)
              const monthly = normalizeNumber(quota.quota_monthly)
              const pct = monthly > 0 ? Math.round((current / monthly) * 100) : null
              return (
                <div key={quota.quota_feature} className="rounded-lg border border-[var(--elevation-border)] px-4 py-3 space-y-1.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-primary">{definition?.label ?? quota.quota_feature}</span>
                    <span className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${getQuotaBadgeClass(quota)}`}>
                      {monthly < 0 ? 'illimité' : `${pct ?? 0}%`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-secondary tabular-nums text-xs">
                    <span>{formatQuotaValue(current)} / {formatQuotaValue(monthly)} {quota.quota_unit}</span>
                    <span>{formatMoney(normalizeNumber(quota.current_cost_eur))}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card px-6 py-5 space-y-3">
        <p className={sectionTitleCls}>Journal cockpit</p>
        {row.events.length === 0 ? (
          <p className="text-sm text-secondary">Aucune action tracée.</p>
        ) : (
          <div className="space-y-3">
            {row.events.slice(0, 8).map((event) => (
              <div key={event.id} className="rounded-lg border border-[var(--elevation-border)] px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-primary">{getEventLabel(event.event_type)}</span>
                  <span className="text-secondary tabular-nums text-xs">{formatDate(event.created_at)}</span>
                </div>
                <p className="mt-1 text-secondary text-xs">
                  {event.actor_email ?? 'system'}
                  {event.notes ? ` · ${event.notes}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card px-6 py-5 space-y-3">
        <p className={sectionTitleCls}>CRM commercial</p>
        {row.commercialEvents.length === 0 ? (
          <p className="text-sm text-secondary">Aucune action commerciale tracée.</p>
        ) : (
          <div className="space-y-3">
            {row.commercialEvents.slice(0, 8).map((event) => {
              const deliveryStatus = typeof event.metadata?.delivery_status === 'string'
                ? event.metadata.delivery_status
                : null
              return (
                <div key={event.id} className="rounded-lg border border-[var(--elevation-border)] px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-primary">{getCommercialEventLabel(event.event_type)}</span>
                    <span className="text-secondary tabular-nums text-xs">{formatDate(event.sent_at)}</span>
                  </div>
                  <p className="mt-1 text-secondary text-xs">
                    {deliveryStatus ? `${deliveryStatus} · ` : ''}{event.subject_preview ?? event.email_template ?? event.sent_by}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
