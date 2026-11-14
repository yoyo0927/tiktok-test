import { defaultTuning } from './tuning.ts'

const BURST_INTERVAL_MS = 1050

export type Expression = 'neutral' | 'smile' | 'laugh'
export interface Scores { smile: number; open: number }

export class ExpressionMachine {
  state: Expression = 'neutral'
  smile = 0
  open = 0
  laugh = 0
  private pending: Expression = 'neutral'
  private pendingSince = 0
  private pendingSamples = 0
  private lastSample: number | null = null
  private lastBurst = -Infinity

  interrupt() { this.pendingSamples = 0 }

  reset() {
    this.state = 'neutral'
    this.smile = this.open = this.laugh = 0
    this.pending = 'neutral'
    this.pendingSamples = 0
    this.lastSample = null
  }

  update(scores: Scores, now: number, tuning = defaultTuning): boolean {
    const gap = this.lastSample === null ? 70 : now - this.lastSample
    if (gap > 240) this.pendingSamples = 0
    this.lastSample = now
    const blend = 1 - Math.exp(-gap / 75)
    this.smile += (scores.smile - this.smile) * blend
    this.open += (scores.open - this.open) * blend
    this.laugh = Math.min(this.smile, this.open)

    const wasLaughing = this.state === 'laugh'
    const smileThreshold = 0.32 - (tuning.smileSensitivity - 60) * 0.003
    const laughAdjustment = (tuning.laughSensitivity - 65) * 0.003
    const laughSmile = 0.43 - laughAdjustment * 0.6 - (wasLaughing ? 0.10 : 0)
    const strongSmile = Math.min(0.065, Math.max(0, this.smile - 0.60) * 0.20)
    const laughOpen = 0.37 - laughAdjustment - strongSmile - (wasLaughing ? 0.09 : 0)
    const laughing = this.smile >= laughSmile && this.open >= laughOpen
    const smiling = this.smile >= smileThreshold - (this.state === 'neutral' ? 0 : 0.10)
    const next = laughing ? 'laugh' : smiling ? 'smile' : 'neutral'
    if (next === this.state) {
      this.pendingSamples = 0
      return next === 'laugh' && this.burstDue(now)
    }

    if (next !== this.pending || this.pendingSamples === 0) {
      this.pending = next
      this.pendingSince = now
      this.pendingSamples = 0
    }
    this.pendingSamples++
    const confirmation = next === 'laugh' ? 90 : next === 'smile' && !wasLaughing ? 110 : 150
    if (this.pendingSamples < 3 || now - this.pendingSince < confirmation) return false

    this.state = next
    this.pendingSamples = 0
    return next === 'laugh' && this.burstDue(now)
  }

  private burstDue(now: number) {
    if (now - this.lastBurst < BURST_INTERVAL_MS) return false
    this.lastBurst = now
    return true
  }
}
