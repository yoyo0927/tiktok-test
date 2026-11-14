import { collideWithHead } from './collision.ts'
import type { Body } from './collision.ts'
import type { Ellipse, MovingHead, Point } from './geometry.ts'
import type { Expression } from './expression.ts'
import type { Quality } from './performance.ts'
import type { Tuning } from './tuning.ts'
import { bodyClearance, estimateBody } from './bodyRegion.ts'
import type { BodyRegion } from './bodyRegion.ts'

export type ParticleKind = 'rain' | 'bokeh' | 'ray' | 'spark' | 'glint' | 'star' | 'contactStar' | 'tailBurst' | 'streamer' | 'shape'
export const HISTORY = 26
export const HISTORY_STEP = 0.024
export const BLOOM_GLOW_LIFE = 0.60
const RAY_DRAG = 1.25
export interface Particle extends Body {
  kind: ParticleKind
  life: number
  age: number
  palette: number
  width: number
  gravity: number
  rotation: number
  spin: number
  sides: number
  collidable: boolean
  whiteFlash: boolean
  history: Float32Array
  cursor: number
  samples: number
  sampleAge: number
  tailBurstAt: number
}

export function trailSampleCount(particle: Particle, tuning: Tuning, quality: Quality) {
  return Math.min(particle.samples, Math.round(tuning.fireworkTrail / 1000 / HISTORY_STEP * quality.trailScale))
}

export const rainColors = ['#ff67c4', '#a978ff', '#58d9ff', '#64f5db', '#d2fb85', '#ffffff']
export const fireworkColors = [
  { glow: '#3389df', ray: '#56d6f8', tip: '#c0f3ff' },
  { glow: '#855be1', ray: '#b597ff', tip: '#e9ddff' },
  { glow: '#d52b81', ray: '#ff77b4', tip: '#ffe0f2' },
  { glow: '#d78a43', ray: '#ffd095', tip: '#fff0d9' },
  { glow: '#299e8e', ray: '#72e8cb', tip: '#d7fff1' },
  { glow: '#505cdf', ray: '#8299ff', tip: '#dce5ff' },
]
const fireworkPairs = [[0, 1], [2, 3], [4, 5], [1, 2], [4, 1]] as const
const landscapePairs = [...fireworkPairs, [0, 2], [3, 5], [0, 4]] as const
const bloomSizes = [1, 0.79, 0.61, 0.46, 0.32, 0.30, 0.28, 0.26]
const petalCounts = [1, 0.55, 0.42, 0.32, 0.24, 0.21, 0.18, 0.15]
const CAPACITY = 780
const RAIN_CAP = 300
const TAU = Math.PI * 2
const random = (min: number, max: number) => min + Math.random() * (max - min)

interface Bloom extends Point { radius: number; age: number; order: number; palette: number; accentPalette: number; delay: number }
type Foreground = (x: number, y: number) => boolean

function faceClearance(x: number, y: number, head: Ellipse, padding: number) {
  const dx = x - head.x
  const dy = y - head.y
  const cos = Math.cos(head.angle)
  const sin = Math.sin(head.angle)
  return Math.hypot((cos * dx + sin * dy) / (head.rx + padding), (-sin * dx + cos * dy) / (head.ry + padding))
}

function openSpace(x: number, y: number, head: Ellipse | null, body: BodyRegion, gap: number, foreground?: Foreground) {
  if ((head && faceClearance(x, y, head, gap) < 1) || bodyClearance(x, y, body) < gap) return false
  if (!foreground) return true
  if (foreground(x, y)) return false
  for (let i = 0; i < 12; i++) {
    const angle = i * TAU / 12
    if (foreground(x + Math.cos(angle) * gap, y + Math.sin(angle) * gap)
      || foreground(x + Math.cos(angle) * gap * 0.5, y + Math.sin(angle) * gap * 0.5)) return false
  }
  return true
}

function chooseOrigin(width: number, height: number, head: Ellipse | null, body: BodyRegion,
  others: readonly Point[], previous: Point | null, foreground?: Foreground): Point | null {
  const shortSide = Math.min(width, height)
  const gap = originGap(width, height)
  const margin = shortSide * 0.13
  let best: Point | null = null
  let bestScore = -Infinity
  for (let i = 0; i < 56; i++) {
    const edge = i >= 40
    const x = edge ? (i % 2 === 0 ? 0.035 : 0.965) * width : random(margin, width - margin)
    const y = edge ? random(height * 0.035, height * 0.92) : random(margin, height * 0.74)
    if (!openSpace(x, y, head, body, gap, foreground)) continue
    let score = Math.random() * 0.75
    if (edge) score -= 0.95
    if (head) {
      const clearance = faceClearance(x, y, head, gap)
      // Leave the face clear, but keep blooms near enough for their spokes to reach it.
      score -= Math.abs(clearance - 1.38) * 0.88
      if (others.length === 0 && y > head.y + head.ry * 0.35) score -= 0.85
    }
    for (const point of others) {
      score -= 2.8 * Math.max(0, 1 - Math.hypot(x - point.x, y - point.y) / (shortSide * 0.56))
    }
    if (previous) score -= 2 * Math.max(0, 1 - Math.hypot(x - previous.x, y - previous.y) / (shortSide * 0.42))
    if (score <= bestScore) continue
    best = { x, y }
    bestScore = score
  }
  return best
}

function originGap(width: number, height: number) {
  return Math.max(22, Math.min(42, Math.min(width, height) * 0.065))
}

export class ParticleEngine {
  readonly pool: Particle[] = Array.from({ length: CAPACITY }, () => ({
    kind: 'rain', x: 0, y: 0, vx: 0, vy: 0, radius: 1, age: 0, life: 0, palette: 0, width: 0, gravity: 0,
    rotation: 0, spin: 0, sides: 0, collidable: false, whiteFlash: false,
    history: new Float32Array(HISTORY * 2), cursor: 0, samples: 0, sampleAge: 0, tailBurstAt: Infinity,
  }))
  readonly blooms: Bloom[] = []
  count = 0
  impacts = 0
  rainVisibility = 1
  private lastPair = -1
  private lastOrigin: Point | null = null
  private rain = 0
  private rainCount = 0
  private bokehCount = 0
  private rainBudget = 0
  private bokehBudget = 0
  private contactStars = 0
  private tailBursts = 0
  private headContact = { x: 0, y: 0, nx: 0, ny: 0 }

  private spawn(kind: ParticleKind, x: number, y: number, vx: number, vy: number, life: number, radius: number, palette: number, collidable = false) {
    if (this.count >= CAPACITY) return null
    const p = this.pool[this.count++]
    p.kind = kind
    p.x = x
    p.y = y
    p.vx = vx
    p.vy = vy
    p.age = 0
    p.life = life
    p.radius = radius
    p.palette = palette
    p.collidable = collidable
    p.whiteFlash = false
    p.cursor = 0
    p.samples = 1
    p.sampleAge = 0
    p.tailBurstAt = Infinity
    p.history[0] = x
    p.history[1] = y
    if (kind === 'rain') this.rainCount++
    if (kind === 'bokeh') this.bokehCount++
    return p
  }

  private scatterContact(palette: number, reflectedSpeed: number, amount: number) {
    const { x, y, nx, ny } = this.headContact
    const angle = Math.atan2(ny, nx)
    for (let i = 0; i < amount && this.contactStars < 96; i++) {
      const spread = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? -1 : 1)
      const direction = angle + spread * 0.32 + random(-0.09, 0.09)
      const speed = reflectedSpeed * random(0.68, 1.18)
      const star = this.spawn('contactStar', x + nx * 2.5, y + ny * 2.5,
        Math.cos(direction) * speed, Math.sin(direction) * speed,
        random(0.40, 0.58), random(2.5, 3.9), palette)
      if (!star) break
      star.rotation = random(0, TAU)
      star.spin = random(-6, 6)
      this.contactStars++
    }
  }

  private burstAtTail(p: Particle, width: number, height: number, tuning: Tuning, quality: Quality) {
    p.tailBurstAt = Infinity
    if (this.tailBursts >= 24) return
    const samples = trailSampleCount(p, tuning, quality)
    const tail = ((p.cursor - samples + 1 + HISTORY) % HISTORY) * 2
    const x = p.history[tail]
    const y = p.history[tail + 1]
    if (x < 0 || x > width || y < 0 || y > height) return
    const burst = this.spawn('tailBurst', x, y, p.vx * 0.08, p.vy * 0.08, random(0.32, 0.42), random(7, 13), p.palette)
    if (!burst) return
    burst.rotation = random(0, TAU)
    this.tailBursts++
  }

  private remove(index: number) {
    const p = this.pool[index]
    if (p.kind === 'rain') this.rainCount--
    if (p.kind === 'bokeh') this.bokehCount--
    if (p.kind === 'contactStar') this.contactStars--
    if (p.kind === 'tailBurst') this.tailBursts--
    this.pool[index] = this.pool[--this.count]
    this.pool[this.count] = p
  }

  private radial(bloom: Bloom, head: Ellipse | null, quality: Quality, tuning: Tuning) {
    const { x, y, radius, palette, accentPalette } = bloom
    const primary = bloom.order === 0
    const count = Math.round(tuning.fireworkPetals * quality.rayScale * petalCounts[bloom.order])
    const whiteCount = Math.max(2, Math.round(count * 0.11))
    const offset = random(0, TAU)
    const width = Math.min(1.15, Math.max(0.70, Math.sqrt(radius / 245)))
    for (let i = 0; i < count; i++) {
      const angle = offset + (i + random(-0.42, 0.42)) * TAU / count
      const speed = radius * (i % 3 ? random(1.35, 2.2) : random(0.56, 1.36))
      const breadth = width * (i % 3 ? random(2.0, 3.9) : random(0.8, 2.05))
      const color = Math.random() < 0.72 ? palette : accentPalette
      const gravity = radius * random(1.22, 1.52)
      let vx = Math.cos(angle) * speed
      let vy = Math.sin(angle) * speed - radius * 0.16
      // A few rays from the larger blooms arc towards the head. The sweep still decides whether they hit.
      if (head && i < (primary ? 7 : bloom.order === 1 ? 3 : 0)) {
        const time = random(0.43, 0.68)
        const travel = -Math.expm1(-RAY_DRAG * time) / RAY_DRAG
        const aimedX = (head.x - x + head.rx * (i % 5 - 2) * 0.30) / travel
        const aimedY = (head.y - y + head.ry * random(-0.35, 0.35) - gravity / RAY_DRAG * (time - travel)) / travel
        if (Math.hypot(aimedX, aimedY) <= Math.max(540, radius * 4.1)) {
          vx = aimedX
          vy = aimedY
        }
      }
      const ray = this.spawn('ray', x, y, vx, vy, random(0.92, 1.28), breadth * 0.72, color, true)
      if (!ray) break
      ray.whiteFlash = Math.floor((i + 1) * whiteCount / count) > Math.floor(i * whiteCount / count)
      ray.width = breadth
      ray.gravity = gravity
      const interval = quality.rayScale < 1 ? 17 : 11
      if (i % interval === Math.floor(interval / 2)) ray.tailBurstAt = ray.life * random(0.63, 0.77)
    }
    const sparks = Math.round(quality.sparks * (primary ? 1 : bloomSizes[bloom.order] * 0.6))
    for (let i = 0; i < sparks; i++) {
      const angle = random(0, TAU)
      const speed = radius * random(0.55, 2.2)
      const glint = i % 3 === 1
      const spark = this.spawn(glint ? 'glint' : 'spark', x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
        glint ? random(0.64, 1.08) : random(0.65, 1.25), random(0.6, 1.35), i % 2 ? accentPalette : palette, i % 2 === 0 && !glint)
      if (!spark) break
      spark.gravity = radius * 0.79
    }

    const stars = primary ? 3 : 1
    for (let i = 0; i < stars; i++) {
      const angle = offset + (i + 0.3) * TAU / stars
      const speed = radius * random(0.9, 1.45)
      const star = this.spawn('star', x, y, Math.cos(angle) * speed, Math.sin(angle) * speed - radius * 0.21,
        random(0.65, 1.02), random(3.1, 5.6) * width, i % 2 ? palette : accentPalette)
      if (!star) break
      star.gravity = radius * 0.78
      star.rotation = random(0, TAU)
      star.spin = random(-2.8, 2.8)
    }

    const accents = primary ? quality.accents : Math.ceil(quality.accents * bloomSizes[bloom.order] * 0.65)
    for (let i = 0; i < accents; i++) {
      const angle = offset + (i + random(-0.34, 0.34)) * TAU / accents
      const streamer = i % 2 === 0
      const speed = radius * (streamer ? random(0.60, 1.2) : random(0.90, 1.45))
      const size = width * (streamer ? random(11, 17) : random(10, 15))
      const accent = this.spawn(streamer ? 'streamer' : 'shape', x, y,
        Math.cos(angle) * speed, Math.sin(angle) * speed - radius * 0.20,
        random(0.85, 1.22), size, i % 4 < 2 ? accentPalette : palette)
      if (!accent) break
      accent.gravity = radius * 0.52
      accent.rotation = random(0, TAU)
      accent.spin = (i % 4 < 2 ? 1 : -1) * random(1.8, 3.4)
      accent.sides = [0, 3, 4][Math.floor(i / 2) % 3]
    }
  }

  burst(head: Ellipse | null, width: number, height: number, quality: Quality, tuning: Tuning,
    body = estimateBody(head, height), foreground?: Foreground) {
    const shortSide = Math.min(width, height)
    const radius = shortSide * 0.49 * tuning.fireworkSize / 100
    const landscape = width > height
    const palettePairs = landscape ? landscapePairs : fireworkPairs
    const bloomCount = landscape ? quality.landscapeBlooms : quality.blooms
    const previous = this.lastPair
    const pairs = palettePairs.map((_, i) => i)
    const mainPairs = pairs.filter((i) => i !== previous)
    const mainPair = mainPairs[Math.floor(random(0, mainPairs.length))]
    pairs.splice(mainPair, 1)
    this.lastPair = mainPair
    for (let order = 0; order < bloomCount; order++) {
      const pair = order === 0 ? mainPair : pairs.splice(Math.floor(random(0, pairs.length)), 1)[0]
      const colors = palettePairs[pair]
      const origin = chooseOrigin(width, height, head, body, this.blooms, this.lastOrigin, foreground)
      if (!origin) break
      const bloom = { ...origin, radius: radius * bloomSizes[order], order,
        palette: colors[order % 2], accentPalette: colors[1 - order % 2], delay: order * 0.09, age: 0 }
      this.blooms.push(bloom)
      if (order === 0) {
        this.lastOrigin = origin
        this.radial(bloom, head, quality, tuning)
      }
    }
  }

  update(dt: number, width: number, height: number, state: Expression, head: MovingHead | null, quality: Quality, tuning: Tuning,
    body = estimateBody(head, height), foreground?: Foreground) {
    const fireworks = state === 'laugh' || this.blooms.length > 0 || this.count > this.rainCount + this.bokehCount
    const target = state === 'smile' && !fireworks ? 1 : 0
    this.rainVisibility = fireworks ? Math.max(0, this.rainVisibility - dt / 0.12)
      : Math.min(1, this.rainVisibility + dt / 0.4)
    this.rain += (target - this.rain) * (1 - Math.exp(-dt / 0.25))
    if (fireworks) this.rainBudget = this.bokehBudget = 0
    else this.rainBudget += this.rain * tuning.rainDensity * quality.rainScale * dt
    const angle = tuning.rainDirection * Math.PI / 180
    const dx = Math.sin(angle)
    const dy = Math.cos(angle)
    while (this.rainBudget >= 1) {
      this.rainBudget--
      if (this.rainCount >= RAIN_CAP) break
      const drift = dx / dy * height
      const side = Math.random() < Math.abs(drift) / (width + Math.abs(drift))
      const x = side ? (drift > 0 ? -8 : width + 8) : random(0, width)
      const y = side ? random(0, height) : -8
      const scale = random(0.72, 1.3)
      const color = Math.floor(Math.random() ** 1.45 * rainColors.length)
      this.spawn('rain', x, y, dx * scale, dy * scale, random(0.75, 1.15), scale, color)
    }
    this.rainBudget %= 1
    if (!fireworks) this.bokehBudget += this.rain * Math.min(7, tuning.rainDensity * 0.067) * quality.rainScale * dt
    while (this.bokehBudget >= 1) {
      this.bokehBudget--
      const size = random(10, 25) * Math.min(1.1, width / 400)
      const speed = tuning.rainSpeed * random(0.10, 0.19)
      this.spawn('bokeh', random(0, width), random(height * 0.04, height * 0.84), dx * speed, dy * speed,
        random(1.4, 2.15), size, Math.floor(random(0, rainColors.length)))
    }

    for (let i = this.blooms.length - 1; i >= 0; i--) {
      const bloom = this.blooms[i]
      if (bloom.delay > 0) {
        bloom.delay -= dt
        if (bloom.delay <= 0) {
          if (bloom.x > width || bloom.y > height || !openSpace(bloom.x, bloom.y, head, body, originGap(width, height), foreground)) {
            const origin = chooseOrigin(width, height, head, body, this.blooms, this.lastOrigin, foreground)
            if (!origin) {
              this.blooms.splice(i, 1)
              continue
            }
            bloom.x = origin.x
            bloom.y = origin.y
          }
          this.radial(bloom, head, quality, tuning)
        }
      } else {
        bloom.age += dt
        if (bloom.age > BLOOM_GLOW_LIFE) this.blooms.splice(i, 1)
      }
    }

    const rayDrag = Math.exp(-dt * RAY_DRAG)
    const sparkDrag = Math.exp(-dt * 1.1)
    const accentDrag = Math.exp(-dt * 1.65)
    const contactDrag = Math.exp(-dt * 3.5)
    // Walk backwards so newly scattered stars start aging on the next frame.
    for (let i = this.count - 1; i >= 0; i--) {
      const p = this.pool[i]
      if (p.kind === 'rain') {
        p.age += dt / tuning.rainLife
        const speed = tuning.rainSpeed * p.radius
        p.vx = dx * speed
        p.vy = dy * speed
        p.x += p.vx * dt
        p.y += p.vy * dt
      } else if (p.kind === 'bokeh' || p.kind === 'contactStar' || p.kind === 'tailBurst') {
        p.age += dt
        if (p.kind === 'contactStar') {
          p.rotation += p.spin * dt
          p.vx *= contactDrag
          p.vy *= contactDrag
        }
        p.x += p.vx * dt
        p.y += p.vy * dt
      } else {
        p.age += dt
        const px = p.x
        const py = p.y
        const accent = p.kind === 'streamer' || p.kind === 'shape'
        const drag = accent ? accentDrag : p.kind === 'ray' ? rayDrag : sparkDrag
        if (p.kind === 'star') p.rotation += p.spin * dt
        if (accent) {
          p.rotation += p.spin * dt
          p.vx += Math.sin(p.rotation * 2) * p.radius * 3.5 * dt
        }
        p.vx *= drag
        p.vy = p.vy * drag + p.gravity * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        if (p.collidable && head && collideWithHead(p, px, py, head, this.headContact)) {
          const { palette, kind } = p
          const speed = Math.max(66, Math.min(144, Math.hypot(p.vx - head.vx, p.vy - head.vy) * 0.46))
          this.impacts++
          this.remove(i)
          this.scatterContact(palette, speed, kind === 'ray' ? (quality.rayScale < 1 ? 5 : 7) : 2)
          continue
        }
        p.sampleAge += dt
        if (p.sampleAge >= HISTORY_STEP) {
          p.sampleAge %= HISTORY_STEP
          p.cursor = (p.cursor + 1) % HISTORY
          p.samples = Math.min(HISTORY, p.samples + 1)
          p.history[p.cursor * 2] = p.x
          p.history[p.cursor * 2 + 1] = p.y
        }
        if (p.kind === 'ray' && p.age >= p.tailBurstAt && p.age < p.life) this.burstAtTail(p, width, height, tuning, quality)
      }
      // Keep off-screen rays alive until their trails have left the frame.
      if (p.age >= p.life || (p.kind === 'rain' && (p.y > height + tuning.rainTrail + 12
        || p.x < -tuning.rainTrail - 12 || p.x > width + tuning.rainTrail + 12))) {
        this.remove(i)
      }
    }
  }
}
