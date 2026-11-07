import type { ReactNode } from 'react'
import styles from './layout.module.css'

export default function MonEspaceLayout({ children }: { children: ReactNode }) {
  return <div className={styles.shell}>{children}</div>
}
