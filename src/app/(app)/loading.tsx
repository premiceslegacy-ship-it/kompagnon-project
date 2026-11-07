// @atelier-migrated
import styles from './loading.module.css'

export default function Loading() {
  return (
    <div className={styles.page} role="status">
      <div className={styles.spinner} aria-hidden="true" />
      <p className={styles.label}>Chargement…</p>
    </div>
  )
}
