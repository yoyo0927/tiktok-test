import type { MovingHead } from './geometry.ts'

export interface Body {
  x: number; y: number; vx: number; vy: number; radius: number
}

export interface HeadContact { x: number; y: number; nx: number; ny: number }

// Sweep in the moving ellipse's frame so a fast particle cannot cross its boundary unnoticed.
export function collideWithHead(body: Body, previousX: number, previousY: number, head: MovingHead, contact?: HeadContact): boolean {
  const startX = previousX - head.x + head.dx
  const startY = previousY - head.y + head.dy
  const endX = body.x - head.x
  const endY = body.y - head.y
  const rx = head.rx + body.radius
  const ry = head.ry + body.radius
  const bound = Math.max(rx, ry)
  if (Math.min(startX, endX) > bound || Math.max(startX, endX) < -bound
    || Math.min(startY, endY) > bound || Math.max(startY, endY) < -bound) return false

  const { cos, sin } = head
  const sx = (cos * startX + sin * startY) / rx
  const sy = (-sin * startX + cos * startY) / ry
  const ex = (cos * endX + sin * endY) / rx
  const ey = (-sin * endX + cos * endY) / ry
  const dx = ex - sx
  const dy = ey - sy
  const outside = sx * sx + sy * sy - 1
  let contactX = ex
  let contactY = ey
  if (outside > 0) {
    const a = dx * dx + dy * dy
    const halfB = sx * dx + sy * dy
    const discriminant = halfB * halfB - a * outside
    if (a < 1e-10 || halfB >= 0 || discriminant < 0) return false
    const t = (-halfB - Math.sqrt(discriminant)) / a
    if (t > 1) return false
    contactX = sx + dx * t
    contactY = sy + dy * t
  } else if (ex * ex + ey * ey >= 1) {
    return false
  }

  const length = Math.hypot(contactX, contactY)
  const ux = length > 1e-6 ? contactX / length : 0
  const uy = length > 1e-6 ? contactY / length : -1
  const localNx = ux / rx
  const localNy = uy / ry
  const normalLength = Math.hypot(localNx, localNy)
  const nx = (cos * localNx - sin * localNy) / normalLength
  const ny = (sin * localNx + cos * localNy) / normalLength
  body.x = head.x + cos * ux * rx - sin * uy * ry + nx * 0.7
  body.y = head.y + sin * ux * rx + cos * uy * ry + ny * 0.7

  const approach = (body.vx - head.vx) * nx + (body.vy - head.vy) * ny
  if (approach >= -1) return false
  const impulse = Math.max(26, -0.78 * approach) - approach
  body.vx += impulse * nx
  body.vy += impulse * ny
  if (contact) {
    contact.x = head.x + cos * ux * head.rx - sin * uy * head.ry
    contact.y = head.y + sin * ux * head.rx + cos * uy * head.ry
    contact.nx = nx
    contact.ny = ny
  }
  return true
}
