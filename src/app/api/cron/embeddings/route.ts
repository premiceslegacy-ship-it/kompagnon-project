import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseRuntimeConfig } from '@/lib/supabase/config'

export const dynamic = 'force-dynamic';
import { generateEmbedding } from '@/lib/ai/embeddings'
import { verifyCronSecret } from '@/lib/cron-auth'

const BATCH_SIZE = 50

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { supabaseUrl } = getSupabaseRuntimeConfig()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase: any = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: rows, error } = await supabase
    .from('company_memory')
    .select('id, content')
    .is('embedding', null)
    .eq('is_active', true)
    .limit(BATCH_SIZE)

  if (error) {
    console.error('[cron/embeddings] fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!rows?.length) {
    return NextResponse.json({ processed: 0, updated: 0, errors: 0 })
  }

  let updated = 0
  let errors = 0

  for (const row of rows) {
    const embedding = await generateEmbedding(row.content)
    if (!embedding) {
      errors++
      continue
    }

    const { error: updateError } = await supabase
      .from('company_memory')
      .update({ embedding })
      .eq('id', row.id)

    if (updateError) {
      console.error(`[cron/embeddings] update error for ${row.id}:`, updateError)
      errors++
    } else {
      updated++
    }
  }

  console.log(`[cron/embeddings] processed=${rows.length} updated=${updated} errors=${errors}`)
  return NextResponse.json({ processed: rows.length, updated, errors })
}
