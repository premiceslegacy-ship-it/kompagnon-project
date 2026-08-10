'use client'

import { useState } from 'react'
import EmailsTab from './EmailsTab'
import OverviewTab from './tabs/OverviewTab'
import ClientsTab from './tabs/ClientsTab'
import PricingTab from './tabs/PricingTab'
import type { ClientRow, CommercialRecommendation, OperatorCommercialEvent, OperatorUsageEvent, UsageAggregateRow } from './types'

type FailedWebhookEvent = {
  source_id: string
  event_type: string
  error_msg: string | null
  received_at: string
}

type EmailClientOption = {
  sourceInstance: string
  organizationId: string | null
  label: string
  tier: string
  recipientEmail: string | null
}

type CockpitTab = 'overview' | 'clients' | 'pricing' | 'emails'

type Props = {
  activeCount: number
  costTotalEur: number
  usageTotalEur: number
  revenueTotalEur: number
  rowsWithFeeCount: number
  grossMarginTotalEur: number
  marginRate: number | null
  missingBillingCount: number
  sharedAppUrlRows: ClientRow[]
  missingOrgIdRows: ClientRow[]
  neverAttemptedRows: ClientRow[]
  technicalFailureRows: ClientRow[]
  failedWebhookEvents: FailedWebhookEvent[]
  instanceOrgCount: Record<string, number>
  recentEvents: OperatorUsageEvent[]
  clientRows: ClientRow[]
  lowMarginRows: ClientRow[]
  expensiveRows: ClientRow[]
  featureUsageRows: UsageAggregateRow[]
  modelUsageRows: UsageAggregateRow[]
  pricingSignalRows: ClientRow[]
  recommendations: CommercialRecommendation[]
  pendingAlerts: OperatorCommercialEvent[]
  sentEmails: OperatorCommercialEvent[]
  emailClients: EmailClientOption[]
}

const TABS: { id: CockpitTab; label: string }[] = [
  { id: 'overview', label: 'Vue d\'ensemble' },
  { id: 'clients', label: 'Clients' },
  { id: 'pricing', label: 'Pricing & IA' },
  { id: 'emails', label: 'Emails' },
]

export default function CockpitTabs(props: Props) {
  const [activeTab, setActiveTab] = useState<CockpitTab>('overview')
  const pendingCount = props.pendingAlerts.length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-[var(--elevation-border)] pb-3">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 rounded-pill px-4 py-2 text-xs font-bold font-display uppercase tracking-wide transition-colors ${
              activeTab === tab.id
                ? 'bg-accent text-white'
                : 'border border-[var(--elevation-border)] text-secondary hover:text-primary hover:bg-interactive/60'
            }`}
          >
            {tab.label}
            {tab.id === 'emails' && pendingCount > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-[11px] font-bold">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <OverviewTab
          activeCount={props.activeCount}
          costTotalEur={props.costTotalEur}
          usageTotalEur={props.usageTotalEur}
          revenueTotalEur={props.revenueTotalEur}
          rowsWithFeeCount={props.rowsWithFeeCount}
          grossMarginTotalEur={props.grossMarginTotalEur}
          marginRate={props.marginRate}
          missingBillingCount={props.missingBillingCount}
          sharedAppUrlRows={props.sharedAppUrlRows}
          missingOrgIdRows={props.missingOrgIdRows}
          neverAttemptedRows={props.neverAttemptedRows}
          technicalFailureRows={props.technicalFailureRows}
          failedWebhookEvents={props.failedWebhookEvents}
          instanceOrgCount={props.instanceOrgCount}
          recentEvents={props.recentEvents}
          clientRows={props.clientRows}
        />
      )}

      {activeTab === 'clients' && (
        <ClientsTab
          clientRows={props.clientRows}
          lowMarginRows={props.lowMarginRows}
          expensiveRows={props.expensiveRows}
        />
      )}

      {activeTab === 'pricing' && (
        <PricingTab
          featureUsageRows={props.featureUsageRows}
          modelUsageRows={props.modelUsageRows}
          pricingSignalRows={props.pricingSignalRows}
          recommendations={props.recommendations}
        />
      )}

      {activeTab === 'emails' && (
        <EmailsTab
          pendingAlerts={props.pendingAlerts}
          sentEmails={props.sentEmails}
          clients={props.emailClients}
        />
      )}
    </div>
  )
}
