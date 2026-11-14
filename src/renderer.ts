import type { MovingHead } from './geometry.ts'
import { BLOOM_GLOW_LIFE, fireworkColors, HISTORY, HISTORY_STEP, rainColors, trailSampleCount } from './particles.ts'
import type { Particle, ParticleEngine } from './particles.ts'
import type { Quality } from './performance.ts'
import type { Tuning } from './tuning.ts'
import type { BodyRegion } from './bodyRegion.ts'
import type { PersonMask } from './personMask.ts'

const STAR = Array.from({ length: 10 }, (_, i) => {
  const angle = -Math.PI / 2 + i * Math.PI / 5
  const radius = i % 2 ? 0.43 : 1
  return [Math.cos(angle) * radius, Math.sin(angle) * radius]
})
const WHITE_PETAL = { glow: '#8c9eb8', ray: '#eff5ff', tip: '#ffffff' }

function glowSprite(color: string, ring = false) {
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = 48
  const ctx = sprite.getContext('2d')!
  const halo = ctx.createRadialGradient(24, 24, 0, 24, 24, 24)
  if (ring) {
    halo.addColorStop(0, `${color}0c`)
    halo.addColorStop(0.48, `${color}1c`)
    halo.addColorStop(0.68, `${color}85`)
    halo.addColorStop(0.82, `${color}3c`)
  } else {
    halo.addColorStop(0, `${color}c9`)
    halo.addColorStop(0.27, `${color}70`)
    halo.addColorStop(0.62, `${color}26`)
  }
  halo.addColorStop(1, `${color}00`)
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, 48, 48)
  return sprite
}

function drawGlow(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, radius: number, opacity: number) {
  ctx.globalAlpha = opacity
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2)
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, rotation = 0) {
  const cos = Math.cos(rotation) * radius
  const sin = Math.sin(rotation) * radius
  const [firstX, firstY] = STAR[0]
  ctx.beginPath()
  ctx.moveTo(x + firstX * cos - firstY * sin, y + firstX * sin + firstY * cos)
  for (let i = 1; i < STAR.length; i++) {
    const [dx, dy] = STAR[i]
    ctx.lineTo(x + dx * cos - dy * sin, y + dx * sin + dy * cos)
  }
  ctx.closePath()
  ctx.fill()
}

function clearFace(ctx: CanvasRenderingContext2D, head: MovingHead) {
  const padding = 9 + Math.min(12, Math.hypot(head.vx, head.vy) * 0.035)
  ctx.save()
  ctx.translate(head.x, head.y)
  ctx.rotate(head.angle)
  ctx.scale(head.rx + padding, head.ry + padding)
  const mask = ctx.createRadialGradient(0, 0, 1, 0, 0, 1.23)
  mask.addColorStop(0, '#000')
  mask.addColorStop(1, '#0000')
  ctx.globalCompositeOperation = 'destination-out'
  ctx.globalAlpha = 1
  ctx.fillStyle = mask
  ctx.fillRect(-1.23, -1.23, 2.46, 2.46)
  ctx.restore()
}

function clearEstimatedBody(ctx: CanvasRenderingContext2D, body: BodyRegion) {
  if (!body.length) return
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.globalAlpha = 1
  ctx.strokeStyle = '#000'
  ctx.lineCap = 'round'
  for (const { from, to, radius } of body) {
    ctx.lineWidth = 2 * radius
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }
  ctx.restore()
}

function shapePath(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, angle: number, sides: number) {
  ctx.beginPath()
  if (sides === 0) {
    ctx.ellipse(x, y, radius, radius * 0.76, angle, 0, Math.PI * 2)
    return
  }
  ctx.moveTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
  for (let i = 1; i < sides; i++) {
    const point = angle + i * Math.PI * 2 / sides
    ctx.lineTo(x + Math.cos(point) * radius, y + Math.sin(point) * radius)
  }
  ctx.closePath()
}

function drawShape(ctx: CanvasRenderingContext2D, p: Particle) {
  const reveal = Math.min(1, p.age * 7)
  const opacity = reveal * (1 - p.age / p.life) ** 0.68
  if (opacity < 0.015) return
  const color = fireworkColors[p.palette]
  const size = p.radius * (0.6 + 0.4 * reveal)
  ctx.strokeStyle = color.ray
  ctx.lineJoin = 'round'
  for (const sample of [4, 2]) {
    if (p.samples <= sample) continue
    const index = ((p.cursor - sample + HISTORY) % HISTORY) * 2
    shapePath(ctx, p.history[index], p.history[index + 1], size * (1 - sample * 0.037),
      p.rotation - p.spin * sample * HISTORY_STEP, p.sides)
    ctx.lineWidth = 1
    ctx.globalAlpha = opacity * (sample === 2 ? 0.24 : 0.10)
    ctx.stroke()
  }
  shapePath(ctx, p.x, p.y, size, p.rotation, p.sides)
  ctx.lineWidth = 1.35
  ctx.globalAlpha = opacity * 0.72
  ctx.stroke()
  ctx.lineJoin = 'miter'
}

function drawStreamer(ctx: CanvasRenderingContext2D, p: Particle) {
  const stretch = 1 - Math.exp(-p.age * 7)
  const opacity = Math.min(1, p.age * 9) * (1 - p.age / p.life) ** 0.72
  if (opacity < 0.015) return
  const color = fireworkColors[p.palette]
  const angle = Math.atan2(p.vy, p.vx) + 0.20 * Math.sin(p.rotation * 1.5)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const length = p.radius * (1.05 + 2.65 * stretch)
  const phase = p.rotation * 1.6
  const direction = Math.sign(p.spin)
  const segments = 36
  const axialRadius = p.radius * (0.33 + 0.08 * Math.sin(p.rotation))
  const lateralRadius = p.radius * (0.48 + 0.08 * Math.cos(p.rotation))
  const bend = p.radius * 0.35 * Math.sin(p.rotation)
  // Offset the projected helix along both axes so the coils loop back instead of reading as a wave.
  ctx.beginPath()
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const turn = phase - t * Math.PI * 6 * direction
    const taper = 1 - t * 0.34
    const forward = -t * length + Math.sin(turn) * axialRadius * taper
    const side = Math.cos(turn) * lateralRadius * taper + bend * t * t
    const x = p.x + cos * forward - sin * side
    const y = p.y + sin * forward + cos * side
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  const gradient = ctx.createLinearGradient(p.x, p.y, p.x - cos * length, p.y - sin * length)
  gradient.addColorStop(0, color.tip)
  gradient.addColorStop(0.32, color.ray)
  gradient.addColorStop(0.78, `${color.ray}c8`)
  gradient.addColorStop(1, `${color.ray}28`)
  ctx.strokeStyle = color.glow
  ctx.lineWidth = 3.6
  ctx.globalAlpha = opacity * 0.26
  ctx.stroke()
  ctx.strokeStyle = gradient
  ctx.lineWidth = 1.7
  ctx.globalAlpha = opacity
  ctx.stroke()
}

function trailPath(ctx: CanvasRenderingContext2D, p: Particle, samples: number) {
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
  for (let i = 0; i < samples; i++) {
    const index = ((p.cursor - i + HISTORY) % HISTORY) * 2
    ctx.lineTo(p.history[index], p.history[index + 1])
  }
}

class FireworkRibbon {
  private points = new Float32Array((HISTORY + 1) * 2)
  private edges = new Float32Array((HISTORY + 1) * 4)

  draw(ctx: CanvasRenderingContext2D, p: Particle, samples: number, opacity: number, petalWidth: number) {
    const points = this.points
    const edges = this.edges
    points[0] = p.x
    points[1] = p.y
    let count = 1
    for (let i = 0; i < samples; i++) {
      const index = ((p.cursor - i + HISTORY) % HISTORY) * 2
      const x = p.history[index]
      const y = p.history[index + 1]
      if (Math.hypot(x - points[count * 2 - 2], y - points[count * 2 - 1]) < 0.35) continue
      points[count * 2] = x
      points[count * 2 + 1] = y
      count++
    }

    const color = p.whiteFlash ? WHITE_PETAL : fireworkColors[p.palette]
    const width = petalWidth * Math.min(1, 0.55 + opacity)
    ctx.globalAlpha = opacity
    ctx.beginPath()
    if (count === 1) {
      ctx.fillStyle = color.tip
      ctx.arc(p.x, p.y, width * 0.62, 0, Math.PI * 2)
      ctx.fill()
      return
    }

    const last = count - 1
    for (let i = 0; i <= last; i++) {
      const before = Math.max(0, i - 1) * 2
      const after = Math.min(last, i + 1) * 2
      const dx = points[before] - points[after]
      const dy = points[before + 1] - points[after + 1]
      const t = i / last
      const half = width * (1 - t) ** 0.95 / Math.max(0.35, Math.hypot(dx, dy))
      const nx = -dy * half
      const ny = dx * half
      const j = i * 4
      edges[j] = points[i * 2] + nx
      edges[j + 1] = points[i * 2 + 1] + ny
      edges[j + 2] = points[i * 2] - nx
      edges[j + 3] = points[i * 2 + 1] - ny
    }

    ctx.moveTo(edges[0], edges[1])
    for (let i = 1; i < last; i++) {
      const j = i * 4
      ctx.quadraticCurveTo(edges[j], edges[j + 1], (edges[j] + edges[j + 4]) / 2, (edges[j + 1] + edges[j + 5]) / 2)
    }
    const tailX = points[last * 2]
    const tailY = points[last * 2 + 1]
    ctx.lineTo(tailX, tailY)
    for (let i = last - 1; i > 0; i--) {
      const j = i * 4 + 2
      ctx.quadraticCurveTo(edges[j], edges[j + 1], (edges[j] + edges[j - 4]) / 2, (edges[j + 1] + edges[j - 3]) / 2)
    }
    ctx.lineTo(edges[2], edges[3])
    const capScale = width / Math.hypot(p.x - points[2], p.y - points[3])
    const capX = (p.x - points[2]) * capScale
    const capY = (p.y - points[3]) * capScale
    ctx.bezierCurveTo(edges[2] + capX, edges[3] + capY, edges[0] + capX, edges[1] + capY, edges[0], edges[1])
    ctx.closePath()

    if (Math.hypot(p.x - tailX, p.y - tailY) > 1) {
      const gradient = ctx.createLinearGradient(tailX, tailY, p.x, p.y)
      gradient.addColorStop(0, `${color.glow}22`)
      gradient.addColorStop(0.22, `${color.glow}8c`)
      gradient.addColorStop(0.64, color.ray)
      gradient.addColorStop(1, color.tip)
      ctx.fillStyle = gradient
    } else {
      ctx.fillStyle = color.ray
    }
    ctx.fill()
  }
}

export class Renderer {
  width = 0
  height = 0
  private dpr = 0
  private ctx: CanvasRenderingContext2D
  private ribbon = new FireworkRibbon()
  private rainGlows = rainColors.map((color) => glowSprite(color))
  private bokehGlows = rainColors.map((color) => glowSprite(color, true))
  private fireworkGlows = fireworkColors.map(({ ray }) => glowSprite(ray))
  private whiteGlow = glowSprite('#ffffff')

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器无法使用 Canvas 2D。')
    this.ctx = ctx
  }

  resize(width: number, height: number, maxDpr: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)
    if (width === this.width && height === this.height && dpr === this.dpr) return false
    this.width = width
    this.height = height
    this.dpr = dpr
    this.canvas.width = Math.max(1, Math.round(width * dpr))
    this.canvas.height = Math.max(1, Math.round(height * dpr))
    this.ctx.setTransform(this.canvas.width / Math.max(1, width), 0, 0, this.canvas.height / Math.max(1, height), 0, 0)
    return true
  }

  draw(engine: ParticleEngine, head: MovingHead | null, debug: boolean, quality: Quality, tuning: Tuning,
    body: BodyRegion, person: PersonMask | null, video: HTMLVideoElement, mirrored: boolean) {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.lineCap = 'round'
    for (let i = 0; engine.rainVisibility > 0 && i < engine.count; i++) {
      const p = engine.pool[i]
      if (p.kind !== 'bokeh') continue
      const t = p.age / p.life
      drawGlow(ctx, this.bokehGlows[p.palette], p.x, p.y, p.radius * (0.76 + t * 0.5), Math.sin(t * Math.PI) * 0.47 * engine.rainVisibility)
    }
    for (let i = 0; engine.rainVisibility > 0 && i < engine.count; i++) {
      const p = engine.pool[i]
      if (p.kind !== 'rain') continue
      const opacity = Math.min(1, p.age * 14) * (1 - p.age / p.life) ** 1.25 * engine.rainVisibility
      const radius = tuning.rainSize * p.radius
      const tail = Math.min(tuning.rainTrail * quality.trailScale, p.age * tuning.rainLife * tuning.rainSpeed)
      const speed = tuning.rainSpeed * p.radius
      const x = p.vx / speed * tail
      const y = p.vy / speed * tail
      drawGlow(ctx, this.rainGlows[p.palette], p.x, p.y, radius * 2.65, opacity * 0.56)
      const color = rainColors[p.palette]
      if (tail > 1) {
        const gradient = ctx.createLinearGradient(p.x - x, p.y - y, p.x, p.y)
        gradient.addColorStop(0, `${color}00`)
        gradient.addColorStop(0.42, `${color}35`)
        gradient.addColorStop(0.78, `${color}85`)
        gradient.addColorStop(1, color)
        ctx.strokeStyle = gradient
        ctx.beginPath()
        ctx.moveTo(p.x - x, p.y - y)
        ctx.lineTo(p.x, p.y)
        ctx.globalAlpha = opacity * 0.19
        ctx.lineWidth = Math.max(2, radius * 0.72)
        ctx.stroke()
        ctx.globalAlpha = opacity * 0.86
        ctx.lineWidth = Math.max(0.65, radius * 0.22)
        ctx.stroke()
        const spacing = 10 + p.radius * 5
        const offset = (p.radius * 17) % spacing
        for (let distance = spacing + offset, i = 0; distance < tail * 0.95; distance += spacing, i++) {
          const t = distance / tail
          const flicker = 0.59 + 0.41 * Math.cos(p.age * 35 + p.radius * 10 + i * 2.7)
          drawGlow(ctx, this.rainGlows[p.palette], p.x - x * t, p.y - y * t,
            Math.max(2.3, radius * (1.13 - t * 0.55)), opacity * (1 - t) * flicker)
        }
      }
      ctx.fillStyle = color
      ctx.globalAlpha = opacity
      drawStar(ctx, p.x, p.y, radius)
    }

    ctx.globalCompositeOperation = 'lighter'
    for (const bloom of engine.blooms) {
      if (bloom.delay > 0) continue
      const { x, y, age, palette } = bloom
      const color = fireworkColors[palette % fireworkColors.length]
      const radius = Math.max(1, bloom.radius * (0.18 + age * 0.65))
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius)
      glow.addColorStop(0, color.tip)
      glow.addColorStop(0.14, color.ray)
      glow.addColorStop(0.43, `${color.glow}85`)
      glow.addColorStop(1, `${color.glow}00`)
      ctx.globalAlpha = Math.max(0, 1 - age / BLOOM_GLOW_LIFE) ** 1.45 * 0.85
      ctx.fillStyle = glow
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
      this.drawBloomRing(x, y, bloom.radius, age, palette, 0)
      if (quality.rayScale === 1 && bloom.order < 2) this.drawBloomRing(x, y, bloom.radius * 0.72, age, bloom.accentPalette, 0.10)
    }

    ctx.globalCompositeOperation = 'source-over'
    const widthScale = tuning.fireworkPetalWidth / 100
    for (let i = 0; i < engine.count; i++) {
      const p = engine.pool[i]
      if (p.kind === 'ray') {
        this.drawRay(p, trailSampleCount(p, tuning, quality), widthScale)
        continue
      }
      if (p.kind === 'tailBurst') {
        this.drawTailBurst(p)
        continue
      }
      if (p.kind === 'star') {
        const twinkle = 0.68 + 0.32 * Math.cos(p.age * 26 + p.radius * 5)
        const opacity = Math.min(1, p.age * 16) * (1 - p.age / p.life) ** 0.8 * twinkle
        drawGlow(ctx, this.fireworkGlows[p.palette], p.x, p.y, p.radius * 3.1, opacity * 0.8)
        ctx.fillStyle = fireworkColors[p.palette].tip
        ctx.globalAlpha = opacity
        drawStar(ctx, p.x, p.y, p.radius * (0.8 + 0.2 * twinkle), p.rotation)
        continue
      }
      if (p.kind === 'glint') {
        const shimmer = (0.5 + 0.5 * Math.sin(p.age * 27 + p.radius * 19)) ** 3
        const opacity = Math.min(1, p.age * 10) * (1 - p.age / p.life) * (0.18 + shimmer * 0.82)
        if (opacity < 0.03) continue
        const size = p.radius * (0.65 + shimmer * 0.65)
        if (shimmer > 0.65) drawGlow(ctx, this.whiteGlow, p.x, p.y, size * 4.2, opacity * 0.52)
        ctx.globalAlpha = opacity
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2)
        ctx.fill()
        continue
      }
      if (p.kind !== 'spark') continue
      const color = fireworkColors[p.palette]
      const opacity = (1 - p.age / p.life) ** 1.65
      ctx.globalAlpha = opacity * (0.54 + 0.22 * Math.cos(p.age * 24 + p.radius * 11))
      ctx.strokeStyle = color.tip
      ctx.lineWidth = p.radius * 0.94
      trailPath(ctx, p, Math.min(p.samples, 3))
      ctx.stroke()
    }
    for (let i = 0; i < engine.count; i++) {
      const p = engine.pool[i]
      if (p.kind === 'streamer') drawStreamer(ctx, p)
      else if (p.kind === 'shape') drawShape(ctx, p)
    }
    // The soft face padding keeps trails clear. Contact stars start at the actual edge.
    const hasEffects = engine.count > 0 || engine.blooms.length > 0
    if (hasEffects && head) clearFace(ctx, head)
    for (let i = 0; i < engine.count; i++) {
      const p = engine.pool[i]
      if (p.kind !== 'contactStar') continue
      const t = p.age / p.life
      let opacity = (1 - t) ** 1.15
      if (head) {
        const dx = p.x - head.x
        const dy = p.y - head.y
        const distance = Math.hypot((head.cos * dx + head.sin * dy) / head.rx, (-head.sin * dx + head.cos * dy) / head.ry)
        const edgeDistance = (distance - 1) * Math.min(head.rx, head.ry)
        opacity *= Math.max(0, Math.min(1, edgeDistance / 2.5))
      }
      if (opacity < 0.01) continue
      drawGlow(ctx, this.fireworkGlows[p.palette], p.x, p.y, p.radius * 2.5, opacity * 0.52)
      ctx.globalAlpha = opacity
      ctx.fillStyle = fireworkColors[p.palette].tip
      drawStar(ctx, p.x, p.y, p.radius * (1 - t * 0.35), p.rotation)
    }
    if (hasEffects) {
      if (!person?.erase(ctx, this.width, this.height, video, mirrored)) clearEstimatedBody(ctx, body)
    }
    ctx.globalAlpha = 1
    if (debug && head) {
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#61ffdd'
      ctx.setLineDash([6, 5])
      ctx.beginPath()
      ctx.ellipse(head.x, head.y, head.rx, head.ry, head.angle, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  private drawRay(p: Particle, samples: number, widthScale: number) {
    const opacity = (1 - p.age / p.life) ** 0.85
    const width = p.width * widthScale
    const flash = p.whiteFlash ? (0.5 + 0.5 * Math.cos(p.age * 23 + p.radius * 6)) ** 3 : 0
    const brightness = p.whiteFlash ? opacity * (0.58 + flash * 0.42) : opacity
    const glow = p.whiteFlash ? this.whiteGlow : this.fireworkGlows[p.palette]
    drawGlow(this.ctx, glow, p.x, p.y, 4 + width * (2.6 + flash * 1.1), brightness * (0.63 + flash * 0.22))
    this.ribbon.draw(this.ctx, p, samples, brightness, width)
  }

  private drawTailBurst(p: Particle) {
    const ctx = this.ctx
    const t = p.age / p.life
    const opacity = (1 - t) ** 1.25
    const radius = p.radius * (0.27 + 0.86 * t ** 0.55)
    const color = fireworkColors[p.palette]
    drawGlow(ctx, this.fireworkGlows[p.palette], p.x, p.y, radius * 1.6, opacity * 0.52)
    ctx.globalAlpha = opacity
    ctx.strokeStyle = color.tip
    ctx.lineWidth = 1.15
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = p.rotation + i * Math.PI / 3
      const dx = Math.cos(angle) * radius * (i % 2 ? 0.74 : 1)
      const dy = Math.sin(angle) * radius * (i % 2 ? 0.74 : 1)
      ctx.moveTo(p.x + dx * t * 0.58, p.y + dy * t * 0.58)
      ctx.lineTo(p.x + dx, p.y + dy)
    }
    ctx.stroke()
    ctx.globalAlpha = opacity * 0.78
    ctx.fillStyle = color.tip
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = p.rotation + i * Math.PI / 3
      const length = radius * (i % 2 ? 0.74 : 1)
      const x = p.x + Math.cos(angle) * length
      const y = p.y + Math.sin(angle) * length
      const dot = 0.55 + (1 - t) * 0.5
      ctx.moveTo(x + dot, y)
      ctx.arc(x, y, dot, 0, Math.PI * 2)
    }
    ctx.fill()
  }

  private drawBloomRing(x: number, y: number, scale: number, age: number, palette: number, delay: number) {
    const t = (age - delay) / 0.48
    if (t < 0 || t >= 1) return
    const ctx = this.ctx
    const color = fireworkColors[palette]
    const radius = scale * (0.065 + 0.75 * (1 - (1 - t) ** 1.6))
    const width = Math.max(2.5, scale * (0.027 - t * 0.014))
    const inner = Math.max(0, radius - width)
    const outer = radius + width
    const gradient = ctx.createRadialGradient(x, y, inner, x, y, outer)
    gradient.addColorStop(0, `${color.glow}00`)
    gradient.addColorStop(0.44, `${color.ray}47`)
    gradient.addColorStop(0.63, `${color.tip}b8`)
    gradient.addColorStop(1, `${color.ray}00`)
    ctx.globalAlpha = Math.min(1, t * 10 + 0.15) * (1 - t) ** 1.7 * (delay ? 0.34 : 0.57)
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(x, y, outer, 0, Math.PI * 2)
    ctx.fill()
  }
}
