import React from 'react'

export default function MonEspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-base text-primary">
      {children}
    </div>
  )
}
