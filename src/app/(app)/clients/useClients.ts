'use client'
// @atelier-migrated
// Logique de la liste Clients : filtre, tri, pagination et actions. L'affichage vit dans ClientsClient.tsx.

import { useCallback, useState } from 'react'
import type { Client } from '@/lib/data/queries/clients'
import { todayParis } from '@/lib/utils'
import { useCreationIntent } from '@/lib/hooks/use-creation-intent'
import { clientStats, exportClientsCsv, filterClients, paginate, sortClients } from './clientsModel'

export type ClientsProps = {
  initialClients: Client[]
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  canImport: boolean
  canEmail: boolean
  orgEmail: string | null
  orgName: string
  orgSignature: string | null
  hasAI: boolean
}

export function useClients({ initialClients, canCreate }: ClientsProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [sortBy, setSortBy] = useState('created_at')
  const [isNewClientOpen, setIsNewClientOpen] = useState(false)
  const [isNewLeadOpen, setIsNewLeadOpen] = useState(false)
  const [importMode, setImportMode] = useState<'clients' | 'leads' | null>(null)
  const [isEmailOpen, setIsEmailOpen] = useState(false)
  const [page, setPage] = useState(1)

  const openNewClient = useCallback(() => setIsNewClientOpen(true), [])
  useCreationIntent(canCreate, openNewClient)

  const allFiltered = sortClients(filterClients(initialClients, searchTerm, statusFilter), sortBy)
  const pageData = paginate(allFiltered, page)
  const stats = clientStats(initialClients)
  const isFiltered = searchTerm !== '' || statusFilter !== 'All'

  const handleExportCSV = () => {
    const blob = new Blob([exportClientsCsv(allFiltered)], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `contacts_export_${todayParis()}.csv`
    link.click()
  }

  return {
    searchTerm, setSearchTerm, statusFilter, setStatusFilter, sortBy, setSortBy,
    isNewClientOpen, setIsNewClientOpen, isNewLeadOpen, setIsNewLeadOpen, importMode, setImportMode,
    isEmailOpen, setIsEmailOpen,
    page, setPage,
    allFiltered, pageData, stats, isFiltered,
    handleExportCSV,
  }
}

export type Clients = ReturnType<typeof useClients>
