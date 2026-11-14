export interface Point { x: number; y: number }
export interface Ellipse extends Point { rx: number; ry: number; angle: number }
export interface MovingHead extends Ellipse {
  dx: number
  dy: number
  vx: number
  vy: number
  cos: number
  sin: number
}

export function coverBounds(width: number, height: number, videoWidth: number, videoHeight: number) {
  const scale = Math.max(width / videoWidth, height / videoHeight)
  const w = videoWidth * scale
  const h = videoHeight * scale
  return { w, h, left: (width - w) / 2, top: (height - h) / 2 }
}

export function coverProjection(width: number, height: number, videoWidth: number, videoHeight: number, mirrored: boolean) {
  const { w, h, left, top } = coverBounds(width, height, videoWidth, videoHeight)
  return (point: Point): Point => ({ x: left + (mirrored ? 1 - point.x : point.x) * w, y: top + point.y * h })
}

export class HeadFollower {
  private value: MovingHead | null = null

  update(target: Ellipse | null, dt: number): MovingHead | null {
    if (!target) {
      this.value = null
      return null
    }
    if (!this.value) {
      this.value = { ...target, dx: 0, dy: 0, vx: 0, vy: 0, cos: Math.cos(target.angle), sin: Math.sin(target.angle) }
      return this.value
    }
    const head = this.value
    const blend = 1 - Math.exp(-dt / 0.05)
    head.dx = (target.x - head.x) * blend
    head.dy = (target.y - head.y) * blend
    head.x += head.dx
    head.y += head.dy
    head.rx += (target.rx - head.rx) * blend
    head.ry += (target.ry - head.ry) * blend
    const deltaAngle = target.angle - head.angle
    head.angle += Math.atan2(Math.sin(deltaAngle), Math.cos(deltaAngle)) * blend
    head.cos = Math.cos(head.angle)
    head.sin = Math.sin(head.angle)
    const speedScale = Math.max(dt, Math.hypot(head.dx, head.dy) / 720)
    head.vx = speedScale > 0 ? head.dx / speedScale : 0
    head.vy = speedScale > 0 ? head.dy / speedScale : 0
    return head
  }
}
