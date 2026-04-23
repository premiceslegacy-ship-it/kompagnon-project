import { getRemindersData } from '@/lib/data/queries/reminders'
import RemindersClient from './RemindersClient'

export default async function RemindersPage() {
  const data = await getRemindersData()
  return <RemindersClient initialData={data} />
}
