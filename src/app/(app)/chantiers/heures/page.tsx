import { getAllPointagesGlobal } from '@/lib/data/queries/chantiers'
import HeuresGlobalesClient from './HeuresGlobalesClient'

export default async function HeuresGlobalesPage() {
  const pointages = await getAllPointagesGlobal()
  return <HeuresGlobalesClient initialPointages={pointages} />
}
