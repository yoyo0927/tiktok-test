export const quality = {
  full: { trackingHz: 18, rainScale: 1, rayScale: 1, blooms: 5, landscapeBlooms: 8, sparks: 30, accents: 12, trailScale: 1, dpr: 1.75 },
  reduced: { trackingHz: 12, rainScale: 0.65, rayScale: 0.68, blooms: 4, landscapeBlooms: 6, sparks: 14, accents: 7, trailScale: 0.70, dpr: 1.25 },
}
export type Quality = (typeof quality)[keyof typeof quality]

export function mobileOverlayScale(width: number, height: number, reduced: boolean) {
  const pixelBudget = reduced ? 180_000 : 260_000
  return Math.min(1, Math.sqrt(pixelBudget / Math.max(1, width * height)))
}

export class MobileTrackingBudget {
  private faceCost = 0
  private slowPoseSamples = 0
  poseMs = 0

  get posePaused() { return this.slowPoseSamples >= 3 }

  recordFace(ms: number) {
    this.faceCost += (ms - this.faceCost) * 0.25
  }

  recordPose(ms: number) {
    this.poseMs = ms
    this.slowPoseSamples = ms >= 24 ? this.slowPoseSamples + 1 : 0
  }

  faceInterval(trackingHz: number) {
    return Math.max(1000 / trackingHz, Math.min(100, this.faceCost * 4.5))
  }
}

export class PerformanceMonitor {
  fps = 0
  reduced = false
  private elapsed = 0
  private frames = 0
  private low = 0
  private high = 0
  private healthyFull = 0
  private recoveryWindows = 4

  get settings() { return this.reduced ? quality.reduced : quality.full }

  sample(seconds: number) {
    this.elapsed += seconds
    this.frames++
    if (this.elapsed < 1) return
    this.fps = Math.round(this.frames / this.elapsed)
    this.frames = this.elapsed = 0
    if (this.reduced) {
      this.high = this.fps >= 55 ? this.high + 1 : 0
      if (this.high >= this.recoveryWindows) {
        this.reduced = false
        this.high = 0
        this.recoveryWindows = Math.min(64, this.recoveryWindows * 6)
      }
      return
    }
    this.healthyFull = this.fps >= 55 ? this.healthyFull + 1 : 0
    if (this.healthyFull >= 12) this.recoveryWindows = 4
    this.low = this.fps < 46 ? this.low + 1 : 0
    if (this.low >= 2) {
      this.reduced = true
      this.low = 0
    }
  }
}
