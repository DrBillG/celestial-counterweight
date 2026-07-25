import type { Vec } from './vec'

export type Kind = 'star' | 'planet' | 'moon' | 'ship' | 'fab'

export interface Body {
  name: string
  kind: Kind
  mass: number
  m0: number                 // mass at run start (stability weighting, budgets)
  pos: Vec
  vel: Vec
  radius: number             // collision + visual scale
  parentName: string | null  // orbital parent ('sun' for planets, planet for moons)
  rNom: number               // nominal orbit radius around parent at run start
  minable?: boolean
}

export function makeBody(b: Omit<Body, 'm0'>): Body {
  return { ...b, m0: b.mass }
}
