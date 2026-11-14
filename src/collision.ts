import type { MovingHead } from './geometry.ts'

export interface Body {
  x: number; y: number; vx: number; vy: number; radius: number
}

export interface HeadContact { x: number; y: number; nx: number; ny: number }
export type Foreground = (x: number, y: number) => boolean
const headConnectionSamples = [0.22, 0.45, 0.70]

function reflect(body: Body, nx: number, ny: number, approach: number) {
  const impulse = Math.max(26, -0.78 * approach) - approach
  body.vx += impulse * nx
  body.vy += impulse * ny
}

export function collideWithHeadSilhouette(body: Body, previousX: number, previousY: number, head: MovingHead,
  contact: HeadContact, foreground: Foreground): boolean {
  // The person mask also contains shoulders and limbs. Use face landmarks to bound the head region.
  const bound = Math.hypot(head.rx * 1.65, head.ry * 1.45)
  if (Math.min(previousX, body.x) > head.x + bound || Math.max(previousX, body.x) < head.x - bound
    || Math.min(previousY, body.y) > head.y + bound || Math.max(previousY, body.y) < head.y - bound) return false

  const dx = body.x - previousX
  const dy = body.y - previousY
  const distance = Math.hypot(dx, dy)
  if (distance < 0.01 || foreground(previousX, previousY)) return false
  const steps = Math.min(96, Math.ceil(distance / 2))
  let step = 1
  for (; step <= steps; step++) {
    if (foreground(previousX + dx * step / steps, previousY + dy * step / steps)) break
  }
  if (step > steps) return false

  let outside = (step - 1) / steps
  let inside = step / steps
  for (let i = 0; i < 5; i++) {
    const middle = (inside + outside) / 2
    if (foreground(previousX + dx * middle, previousY + dy * middle)) inside = middle
    else outside = middle
  }
  const x = previousX + dx * inside
  const y = previousY + dy * inside
  const offsetX = x - head.x
  const offsetY = y - head.y
  const localX = head.cos * offsetX + head.sin * offsetY
  const localY = -head.sin * offsetX + head.cos * offsetY
  const maxSide = head.rx * (localY > head.ry * 0.6 ? 1.2 : 1.65)
  if (Math.abs(localX) > maxSide || localY < -head.ry * 1.45 || localY > head.ry) return false

  // Reject nearby detached foreground, such as a hand separated from the head by background.
  for (const fraction of headConnectionSamples) {
    if (!foreground(x - offsetX * fraction, y - offsetY * fraction)) return false
  }
  let nx = Number(foreground(x - 3, y)) - Number(foreground(x + 3, y))
  let ny = Number(foreground(x, y - 3)) - Number(foreground(x, y + 3))
  const length = Math.hypot(nx, ny)
  if (length && -(nx * dx + ny * dy) > distance * length * 0.25) {
    nx /= length
    ny /= length
  } else {
    nx = -dx / distance
    ny = -dy / distance
  }
  const approach = (body.vx - head.vx) * nx + (body.vy - head.vy) * ny
  if (approach >= -1) return false
  reflect(body, nx, ny, approach)
  contact.x = previousX + dx * outside
  contact.y = previousY + dy * outside
  contact.nx = nx
  contact.ny = ny
  return true
}

// Sweep in the moving ellipse's frame so a fast particle cannot cross its boundary unnoticed.
export function collideWithHead(body: Body, previousX: number, previousY: number, head: MovingHead,
  contact?: HeadContact, isOccluded?: Foreground): boolean {
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
  const boundaryX = head.x + cos * ux * rx - sin * uy * ry
  const boundaryY = head.y + sin * ux * rx + cos * uy * ry

  const relativeVx = body.vx - head.vx
  const relativeVy = body.vy - head.vy
  const approach = relativeVx * nx + relativeVy * ny
  if (approach >= -1) return false
  if (isOccluded) {
    const speed = Math.hypot(relativeVx, relativeVy)
    const vx = relativeVx / speed
    const vy = relativeVy / speed
    // Sample the incoming path outside the edge. A little mask overlap at the rim is expected.
    if (isOccluded(boundaryX - vx * 5, boundaryY - vy * 5)
      && isOccluded(boundaryX - vx * 9, boundaryY - vy * 9)) return false
  }
  body.x = boundaryX + nx * 0.7
  body.y = boundaryY + ny * 0.7
  reflect(body, nx, ny, approach)
  if (contact) {
    contact.x = head.x + cos * ux * head.rx - sin * uy * head.ry
    contact.y = head.y + sin * ux * head.rx + cos * uy * head.ry
    contact.nx = nx
    contact.ny = ny
  }
  return true
}
