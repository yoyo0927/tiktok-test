import type { Ellipse, Point } from './geometry.ts'

export interface Capsule { from: Point; to: Point; radius: number }
export type BodyRegion = readonly Capsule[]

export function bodyClearance(x: number, y: number, body: BodyRegion) {
  let distance = Infinity
  for (const { from, to, radius } of body) {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const fraction = Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / Math.max(1, dx * dx + dy * dy)))
    distance = Math.min(distance, Math.hypot(x - from.x - dx * fraction, y - from.y - dy * fraction) - radius)
  }
  return distance
}

export function estimateBody(head: Ellipse | null, height: number): BodyRegion {
  if (!head) return []
  const from = { x: head.x - Math.sin(head.angle) * head.ry, y: head.y + Math.cos(head.angle) * head.ry * 1.38 }
  return [{ from, to: { x: from.x, y: Math.max(from.y, height) }, radius: head.rx * 1.85 }]
}
