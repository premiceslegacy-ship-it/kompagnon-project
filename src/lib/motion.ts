import type { Transition } from 'motion/react'

export type SpringPreset = 'doux' | 'vif' | 'rebondi' | 'interactif' | 'lent'
export type MotionRole = 'appui' | 'couleur' | 'apparition' | 'deplacement' | 'entree' | 'sortie' | 'pose' | 'reussite' | 'suivi'

type MotionRoleDefinition = {
  transition: Transition
  properties: string
}

// Paramètres arrondis depuis Mouvement.ressort() dans design/maquettes/eco/mouvement.js.
export const motionSprings: Record<SpringPreset, Transition> = {
  doux: { type: 'spring', stiffness: 157.9, damping: 25.13, mass: 1 },
  vif: { type: 'spring', stiffness: 157.9, damping: 21.36, mass: 1 },
  rebondi: { type: 'spring', stiffness: 157.9, damping: 17.59, mass: 1 },
  interactif: { type: 'spring', stiffness: 1754.6, damping: 83.78, mass: 1 },
  lent: { type: 'spring', stiffness: 61.7, damping: 15.71, mass: 1 },
}

export const motionRoleDefinitions: Record<MotionRole, MotionRoleDefinition> = {
  appui: { transition: { duration: 0.1, ease: 'linear' }, properties: 'Échelle 0,97 ou opacité 0,7 pendant l’appui.' },
  couleur: { transition: { duration: 0.32, ease: [0.4, 0, 0.6, 1] }, properties: 'Couleur, fond et bord.' },
  apparition: { transition: { duration: 0.24, ease: [0.25, 0.1, 0.25, 1] }, properties: 'Fondu, avec au plus 8 points de translation.' },
  deplacement: { transition: { duration: 0.3, ease: [0, 0, 0.5, 1] }, properties: 'Position d’un élément de page.' },
  entree: { transition: motionSprings.doux, properties: 'Feuille, panneau et menu : part de l’élément déclencheur.' },
  sortie: { transition: { duration: 0.2, ease: [0.4, 0, 1, 1] }, properties: 'Plus courte que l’entrée ; retourne vers son origine.' },
  pose: { transition: motionSprings.vif, properties: 'Objet lâché, interrupteur ou sélection.' },
  reussite: { transition: motionSprings.rebondi, properties: 'Coche ou anneau qui se ferme, une fois par parcours.' },
  suivi: { transition: motionSprings.interactif, properties: 'Suit le geste ; au relâchement, ressort doux avec sa vitesse.' },
}

const reducedMotionTransition: Transition = { duration: 0.12, ease: 'linear' }

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false

  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function getMotionTransition(role: MotionRole, reduceMotion = prefersReducedMotion()): Transition {
  return reduceMotion ? reducedMotionTransition : motionRoleDefinitions[role].transition
}

export function cascade(count: number, options: { pas?: number; max?: number } = {}): number[] {
  const pas = options.pas || 0.04
  const max = options.max || 0.3
  return Array.from({ length: count }, (_, index) => +Math.min(index * pas, max).toFixed(3))
}
