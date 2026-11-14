import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ExpressionMachine } from '../src/expression.ts'
import { collideWithHead } from '../src/collision.ts'
import { coverProjection } from '../src/geometry.ts'
import { PerformanceMonitor, quality } from '../src/performance.ts'
import { ParticleEngine } from '../src/particles.ts'
import { defaultTuning } from '../src/tuning.ts'
import { bodyClearance } from '../src/bodyRegion.ts'

test('expressions confirm transitions and pace repeated bursts during sustained laughter', () => {
  const machine = new ExpressionMachine()
  let now = 0
  const bursts = []
  function feed(smile, open, frames) {
    for (let i = 0; i < frames; i++) {
      now += 60
      if (machine.update({ smile, open }, now)) bursts.push(now)
    }
  }

  feed(0.95, 0.95, 1)
  assert.equal(machine.state, 'neutral')
  feed(0.08, 0.92, 12)
  assert.equal(machine.state, 'neutral')
  feed(0.75, 0.08, 8)
  assert.equal(machine.state, 'smile')
  feed(0.34, 0.08, 8)
  assert.equal(machine.state, 'smile')
  feed(0.86, 0.93, 66)
  assert.equal(machine.state, 'laugh')
  assert.equal(bursts.length, 4)
  assert.ok(bursts.slice(1).every((time, i) => time - bursts[i] === 1080))
  feed(0.78, 0.10, 35)
  assert.equal(machine.state, 'smile')
  assert.equal(bursts.length, 4)
  feed(0.88, 0.92, 7)
  assert.equal(bursts.length, 5)
  feed(0.10, 0.10, 6)
  assert.equal(machine.state, 'neutral')
  feed(0.95, 0.95, 6)
  assert.equal(machine.state, 'laugh')
  assert.equal(bursts.length, 5)
  feed(0.95, 0.95, 17)
  assert.equal(bursts.length, 6)
})

test('missed observations break consecutive confirmation', () => {
  const machine = new ExpressionMachine()
  const laugh = { smile: 1, open: 1 }
  machine.update(laugh, 60)
  machine.update(laugh, 120)
  machine.interrupt()
  assert.equal(machine.update(laugh, 180), false)
  assert.equal(machine.update(laugh, 240), false)
  assert.equal(machine.update(laugh, 300), true)
})

test('swept collision catches tunneling and uses head velocity in the response', () => {
  const head = { x: 0, y: 0, rx: 30, ry: 50, angle: 0, dx: 0, dy: 0, vx: 0, vy: 0, cos: 1, sin: 0 }
  const body = { x: 0, y: 100, vx: 0, vy: 800, radius: 2 }
  assert.equal(collideWithHead(body, 0, -100, head), true)
  assert.ok(body.y < -52 && body.vy < 0)

  const moving = { ...head, x: 25, dx: 25, vx: 250 }
  const stationary = { x: 45, y: 0, vx: 0, vy: 0, radius: 2 }
  assert.equal(collideWithHead(stationary, 45, 0, moving), true)
  assert.ok(stationary.vx > 0)

  const miss = { x: 45, y: 100, vx: 0, vy: 800, radius: 2 }
  assert.equal(collideWithHead(miss, 45, -100, head), false)
  assert.equal(miss.vy, 800)
})

test('portrait cover crops the landscape camera equally and mirrors x', () => {
  const project = coverProjection(300, 600, 640, 480, true)
  assert.deepEqual(project({ x: 0.5, y: 0.5 }), { x: 150, y: 300 })
  assert.deepEqual(project({ x: 0.25, y: 0.3 }), { x: 350, y: 180 })
})

test('quality drops under sustained low FPS and recovers with a longer delay', () => {
  const monitor = new PerformanceMonitor()
  for (let i = 0; i < 64; i++) monitor.sample(1 / 30)
  assert.equal(monitor.settings, quality.reduced)
  for (let i = 0; i < 260; i++) monitor.sample(1 / 60)
  assert.equal(monitor.settings, quality.full)
})

test('a smaller opening with raised mouth corners can trigger a laugh, and sensitivity changes the threshold', () => {
  const sensitive = new ExpressionMachine()
  const strict = new ExpressionMachine()
  let burst = false
  for (let i = 1; i <= 12; i++) {
    const scores = { smile: 0.76, open: 0.35 }
    if (sensitive.update(scores, i * 60)) burst = true
    strict.update(scores, i * 60, { ...defaultTuning, laughSensitivity: 20 })
  }
  assert.equal(burst, true)
  assert.equal(sensitive.state, 'laugh')
  assert.equal(strict.state, 'smile')
})

test('collidable spokes and sparks originate at the visible bloom and scatter on impact', () => {
  const engine = new ParticleEngine()
  const head = { x: 460, y: 240, rx: 82, ry: 109, angle: 0, dx: 0, dy: 0, vx: 0, vy: 0, cos: 1, sin: 0 }
  engine.burst(head, 900, 520, quality.full, defaultTuning)
  const collidable = engine.pool.slice(0, engine.count).filter(p => p.collidable)
  assert.ok(collidable.some(p => p.kind === 'ray'))
  assert.ok(engine.pool.slice(0, engine.count).filter(p => p.kind === 'ray').every(p => p.collidable))
  assert.ok(collidable.some(p => p.kind === 'spark'))
  assert.ok(collidable.every(p => p.x === engine.blooms[0].x && p.y === engine.blooms[0].y))
  let scattered = false
  for (let i = 0; i < 72; i++) {
    engine.update(1 / 60, 900, 520, 'laugh', head, quality.full, defaultTuning)
    if (engine.pool.slice(0, engine.count).some(p => p.kind === 'contactStar')) scattered = true
  }
  assert.equal(scattered, true)
  assert.ok(engine.impacts > 0)
})

test('an impacting petal is replaced by seven stars moving away from the head', () => {
  const engine = new ParticleEngine()
  const head = { x: 180, y: 160, rx: 30, ry: 50, angle: 0, dx: 0, dy: 0, vx: 0, vy: 0, cos: 1, sin: 0 }
  engine.burst(head, 360, 480, quality.full, defaultTuning)
  const petal = engine.pool[0]
  const palette = petal.palette
  Object.assign(petal, { x: 144, y: 160, vx: 350, vy: 0, gravity: 0, radius: 1, tailBurstAt: 0 })
  engine.count = 1
  engine.blooms.length = 0
  const foreground = (x) => x > 124 && x < 232
  const update = () => engine.update(1 / 30, 360, 480, 'neutral', head, quality.full, defaultTuning, [], foreground)
  update()
  assert.equal(engine.impacts, 1)
  assert.equal(engine.count, 7)
  assert.ok(engine.pool.slice(0, engine.count).every(p => p.kind === 'contactStar' && p.palette === palette
    && p.x <= 124 && p.vx < 0 && p.radius <= 3.9 && p.life >= 0.40 && p.life <= 0.58))
  const start = engine.pool[0].x
  update()
  assert.ok(engine.pool[0].x < start)
  for (let i = 0; i < 17; i++) update()
  assert.equal(engine.count, 0)
})

test('a fading petal spawns a single brief flash at the oldest visible trail sample', () => {
  const engine = new ParticleEngine()
  const tuning = { ...defaultTuning, fireworkTrail: 120 }
  engine.burst(null, 360, 480, quality.full, tuning)
  const petal = engine.pool[0]
  Object.assign(petal, { x: 180, y: 180, age: 0.99, life: 1.5, tailBurstAt: 1, cursor: 7, samples: 8 })
  petal.history[6] = 111
  petal.history[7] = 122
  engine.count = 1
  engine.blooms.length = 0
  const update = () => engine.update(1 / 60, 360, 480, 'neutral', null, quality.full, tuning)
  update()
  assert.equal(engine.count, 2)
  const flash = engine.pool[1]
  assert.deepEqual([flash.kind, flash.x, flash.y, flash.palette], ['tailBurst', 111, 122, petal.palette])
  update()
  assert.equal(engine.count, 2)
  for (let i = 0; i < 15; i++) update()
  assert.equal(engine.count, 2)
  for (let i = 0; i < 14; i++) update()
  assert.equal(engine.count, 0)
})

test('firework origins stay outside the tracked body, including delayed blooms', () => {
  const engine = new ParticleEngine()
  const body = [{ from: { x: 180, y: 230 }, to: { x: 230, y: 540 }, radius: 126 }]
  engine.burst(null, 400, 540, quality.full, defaultTuning, body)
  assert.equal(engine.blooms.length, 5)
  assert.ok(engine.blooms.every(({ x, y }) => bodyClearance(x, y, body) >= 26))
  const pending = engine.blooms[1]
  const before = { x: pending.x, y: pending.y }
  const movedBody = [{ from: before, to: before, radius: 65 }]
  for (let i = 0; i < 8; i++) engine.update(1 / 60, 400, 540, 'laugh', null, quality.full, defaultTuning, movedBody)
  assert.ok(engine.blooms.includes(pending) && bodyClearance(pending.x, pending.y, movedBody) >= 0)

  const occupied = [{ from: { x: 200, y: 270 }, to: { x: 200, y: 270 }, radius: 500 }]
  const noSpace = new ParticleEngine()
  noSpace.burst(null, 400, 540, quality.full, defaultTuning, occupied)
  assert.equal(noSpace.blooms.length, 0)
})

test('each wave uses different two-color blooms of several sizes and launches stars', (t) => {
  let seed = 24681
  t.mock.method(Math, 'random', () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 0x100000000
  })
  const engine = new ParticleEngine()
  const head = { x: 180, y: 260, rx: 95, ry: 130, angle: 0, dx: 0, dy: 0, vx: 0, vy: 0, cos: 1, sin: 0 }
  const positions = new Set()
  let previousPair
  for (let wave = 0; wave < 7; wave++) {
    const settings = wave % 2 ? quality.full : quality.reduced
    engine.burst(head, 360, 520, settings, defaultTuning)
    const main = engine.blooms[0]
    const pairs = engine.blooms.map(({ palette, accentPalette }) => [palette, accentPalette].sort().join(','))
    assert.equal(engine.blooms.length, wave % 2 ? 5 : 4)
    assert.equal(new Set(pairs).size, engine.blooms.length)
    assert.ok(!pairs.includes('0,3'))
    assert.notEqual(pairs[0], previousPair)
    assert.ok(engine.blooms.every(({x, y, radius}, i) => x > 0 && x < 360 && y > 0 && y < 520
      && Math.hypot((x - head.x) / 111, (y - head.y) / 146) >= 1
      && (i === 0 || radius < engine.blooms[i - 1].radius)))
    assert.equal(engine.pool.slice(0, engine.count).filter(p => p.kind === 'star' && p.x === main.x && p.y === main.y).length, 3)
    for (let i = 0; i < 29; i++) engine.update(1 / 60, 360, 520, 'neutral', null, settings, defaultTuning)
    for (const { x, y } of engine.blooms) {
      const petals = engine.pool.slice(0, engine.count).filter(p => p.kind === 'ray'
        && Math.abs(p.history[0] - x) < 0.001 && Math.abs(p.history[1] - y) < 0.001)
      assert.ok(petals.filter(p => p.whiteFlash).length >= 2)
      assert.ok(petals.some(p => !p.whiteFlash))
    }
    positions.add(Math.round(main.x) + ',' + Math.round(main.y))
    previousPair = pairs[0]
    for (let i = 0; i < 132; i++) engine.update(1 / 60, 360, 520, 'neutral', head, quality.full, defaultTuning)
  }
  assert.equal(positions.size, 7)
})

test('star rain goes fully transparent until fireworks and their tail flashes finish', () => {
  const engine = new ParticleEngine()
  const step = (state, frames) => {
    for (let i = 0; i < frames; i++) engine.update(1 / 60, 960, 520, state, null, quality.full, defaultTuning)
  }
  step('smile', 45)
  assert.equal(engine.rainVisibility, 1)
  engine.burst(null, 960, 520, quality.full, defaultTuning)
  assert.ok(engine.pool.slice(0, engine.count).some(p => p.kind === 'glint'))
  step('smile', 10)
  assert.equal(engine.rainVisibility, 0)
  assert.ok(engine.pool.slice(0, engine.count).some(p => p.kind === 'rain'))
  step('smile', 67)
  assert.equal(engine.blooms.length, 0)
  assert.ok(engine.pool.slice(0, engine.count).some(p => p.kind === 'ray'))
  assert.equal(engine.rainVisibility, 0)
  step('smile', 130)
  assert.equal(engine.rainVisibility, 1)
})
