export const quality = {
  full: { trackingHz: 18, rainScale: 1, rayScale: 1, blooms: 5, landscapeBlooms: 8, sparks: 30, accents: 12, trailScale: 1, dpr: 1.75 },
  reduced: { trackingHz: 12, rainScale: 0.65, rayScale: 0.68, blooms: 4, landscapeBlooms: 6, sparks: 14, accents: 7, trailScale: 0.70, dpr: 1.25 },
}
export type Quality = (typeof quality)[keyof typeof quality]

export class PerformanceMonitor {
  fps = 0
  reduced = false
  private elapsed = 0
  private frames = 0
  private low = 0
  private high = 0

  get settings() { return this.reduced ? quality.reduced : quality.full }

  sample(seconds: number) {
    this.elapsed += seconds
    this.frames++
    if (this.elapsed < 1) return
    this.fps = Math.round(this.frames / this.elapsed)
    this.frames = this.elapsed = 0
    this.low = this.fps < 46 ? this.low + 1 : 0
    this.high = this.fps >= 55 ? this.high + 1 : 0
    if (this.low >= 2) this.reduced = true
    if (this.high >= 4) this.reduced = false
  }
}
