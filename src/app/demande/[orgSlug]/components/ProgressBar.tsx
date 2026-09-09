'use client'

import React from 'react'
import { CheckCircle2, ClipboardList, Layers, MapPin, User } from 'lucide-react'
import styles from '../demande.module.css'

const STEP_ICONS = [User, Layers, MapPin, ClipboardList]
const STEP_LABELS = ['Vous', 'Votre projet', 'Le chantier', 'Récapitulatif']

export function ProgressBar({ step }: { step: number }) {
  return (
    <div className={styles.progress}>
      {STEP_LABELS.map((label, i) => {
        const Icon = STEP_ICONS[i]
        const idx = i + 1
        const done = step > idx
        const active = step === idx
        return (
          <React.Fragment key={i}>
            <div className={styles.progressStep}>
              <div className={`${styles.progressDot} ${done ? styles.progressDotDone : ''} ${active ? styles.progressDotActive : ''}`}>
                {done ? <CheckCircle2 /> : <Icon />}
              </div>
              <span className={`${styles.progressLabel} ${active ? styles.progressLabelActive : ''} ${done ? styles.progressLabelDone : ''}`}>
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`${styles.progressLine} ${done ? styles.progressLineDone : ''}`} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
