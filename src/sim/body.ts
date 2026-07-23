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
  // Loosely-bound moon: orbits OUTSIDE its parent's Hill sphere (the jupiter
  // trio — io/europa/ganymede). These are so weakly held that the normal
  // "designed runaway" cascade drives them into their parent faster than any
  // rescue can react, AND a fixed counterweight can't hold them (they fall
  // radially out of its range). So the sim softens their runaway (giving a
  // real reaction window) and the game guides their rescue to Return Slag —
  // a ship-stationed hold that TRACKS the moon and heals its orbit. See the
  // runaway block in sim.ts and dangerGuidance() in hud.ts.
  looseMoon?: boolean
}

export function makeBody(b: Omit<Body, 'm0'>): Body {
  return { ...b, m0: b.mass }
}
