import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    if (!await hasPermission('ai.sarah')) {
      return NextResponse.json({ error: 'permission_denied', code: 'permission_denied' }, { status: 403 })
    }

    const { tache_id } = await req.json()
    if (!tache_id) {
      return NextResponse.json({ error: 'tache_id requis' }, { status: 400 })
    }

    const orgId = await getCurrentOrganizationId()
    if (!orgId) {
      return NextResponse.json({ error: 'Non connecté.' }, { status: 401 })
    }

    const supabase = await createClient()

    // Vérifie que la tâche appartient bien à un chantier de l'organisation
    const { data: tache } = await supabase
      .from('chantier_taches')
      .select('id, chantier:chantiers!inner(organization_id)')
      .eq('id', tache_id)
      .eq('chantier.organization_id', orgId)
      .single()

    if (!tache) {
      return NextResponse.json({ error: 'Tâche introuvable.' }, { status: 404 })
    }

    const { error } = await supabase
      .from('chantier_taches')
      .update({ status: 'termine', updated_at: new Date().toISOString() })
      .eq('id', tache_id)

    if (error) {
      return NextResponse.json({ error: 'Mise à jour impossible.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[sarah/task-complete]', err)
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}
