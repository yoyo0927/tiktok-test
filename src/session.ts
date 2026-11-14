import { ExpressionMachine } from './expression.ts'
import type { Expression } from './expression.ts'
import { projectHead, trackFace } from './faceTracking.ts'
import type { FaceFrame } from './faceTracking.ts'
import { HeadFollower } from './geometry.ts'
import type { Ellipse } from './geometry.ts'
import { ParticleEngine } from './particles.ts'
import { PerformanceMonitor } from './performance.ts'
import { Renderer } from './renderer.ts'
import type { FaceLandmarker } from '@mediapipe/tasks-vision'
import type { Tuning } from './tuning.ts'
import { createBodyTracker, projectBody } from './bodyTracking.ts'
import type { NormalizedLandmark, PoseLandmarker } from '@mediapipe/tasks-vision'
import { PersonMask } from './personMask.ts'

export interface Telemetry {
  state: Expression; tracking: boolean; fps: number; reduced: boolean; particles: number;
  impacts: number; smile: number; open: number; laugh: number; inferenceMs: number; trackingHz: number
}

export const initialTelemetry: Telemetry = {
  state: 'neutral', tracking: false, fps: 0, reduced: false, particles: 0, impacts: 0,
  smile: 0, open: 0, laugh: 0, inferenceMs: 0, trackingHz: 18,
}

export function runSession(
  video: HTMLVideoElement, canvas: HTMLCanvasElement, model: FaceLandmarker | null, mirrored: boolean,
  debug: () => boolean, getTuning: () => Tuning, publish: (data: Telemetry) => void, onError: (error: unknown) => void,
  signal?: AbortSignal,
) {
  const renderer = new Renderer(canvas)
  const engine = new ParticleEngine()
  const expression = new ExpressionMachine()
  const follower = new HeadFollower()
  const performanceMonitor = new PerformanceMonitor()
  const person = model ? new PersonMask() : null
  let raf = 0
  let lastFrame = 0
  let lastInference = -Infinity
  let lastVideoTime = -1
  let lastPublish = -Infinity
  let lastFace = -Infinity
  let lastBurst = -Infinity
  let previewRain = false
  let pendingPreview = false
  let inferenceMs = 0
  let face: FaceFrame | null = null
  let target: Ellipse | null = null
  let pose: PoseLandmarker | null = null
  let bodyPoints: NormalizedLandmark[] | undefined
  let lastPose = -Infinity
  let lastPoseVideoTime = -1
  let stopped = false
  if (model && signal) {
    void createBodyTracker(signal).then((tracker) => {
      if (stopped || signal.aborted) tracker.close()
      else pose = tracker
    }).catch((error: unknown) => {
      if (!stopped && !signal.aborted) console.info('Using estimated body region.', error)
    })
  }
  let width = canvas.clientWidth
  let height = canvas.clientHeight
  const observer = new ResizeObserver(([entry]) => {
    width = entry.contentRect.width
    height = entry.contentRect.height
  })
  observer.observe(canvas)

  const frame = (now: number) => {
    try {
      const elapsed = lastFrame ? (now - lastFrame) / 1000 : 0
      lastFrame = now
      if (elapsed > 0 && elapsed < 0.5) performanceMonitor.sample(elapsed)
      const dt = Math.min(elapsed, 0.05)
      const settings = performanceMonitor.settings
      const tuning = getTuning()
      const resized = renderer.resize(width, height, settings.dpr)
      let burst = false
      const videoReady = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      const poseDue = pose && videoReady && video.currentTime !== lastPoseVideoTime
        && now - lastPose >= (settings.trackingHz === 18 ? 100 : 200)

      if (model && videoReady && (!poseDue || now - lastInference >= 180) && video.currentTime !== lastVideoTime
        && now - lastInference >= 1000 / settings.trackingHz - 4) {
        lastVideoTime = video.currentTime
        lastInference = now
        const start = performance.now()
        const result = trackFace(model, video, now)
        inferenceMs = performance.now() - start
        if (result) {
          face = result
          lastFace = now
          target = projectHead(face, width, height, video, mirrored)
          burst = expression.update(face.scores, now, tuning)
        } else {
          expression.interrupt()
        }
      } else if (poseDue && pose) {
        lastPose = now
        lastPoseVideoTime = video.currentTime
        try {
          pose.detectForVideo(video, now, (result) => {
            bodyPoints = result.landmarks[0]
            person?.update(result.segmentationMasks?.[0])
          })
        } catch (error) {
          console.info('Using estimated body region.', error)
          pose.close()
          pose = null
          bodyPoints = undefined
          person?.update()
        }
      }
      if (face && now - lastFace > 250) {
        face = target = null
        expression.reset()
      }
      if (resized) {
        follower.update(null, 0)
        if (face) target = projectHead(face, width, height, video, mirrored)
      }
      const head = follower.update(target, dt)
      const freshPose = now - lastPose < 420
      const body = projectBody(freshPose ? bodyPoints : undefined, width, height, video, mirrored, head)
      const foreground = freshPose ? person?.project(width, height, video, mirrored) : undefined
      if (burst || pendingPreview && width > 0 && height > 0) {
        pendingPreview = false
        if (now - lastBurst >= 850 && width > 0 && height > 0) {
          lastBurst = now
          engine.burst(head, width, height, settings, tuning, body, foreground)
        }
      }
      const state = previewRain && expression.state === 'neutral' ? 'smile' : expression.state
      engine.update(dt, width, height, state, head, settings, tuning, body, foreground)
      renderer.draw(engine, head, debug(), settings, tuning, body, freshPose ? person : null, video, mirrored)

      if (now - lastPublish >= 200) {
        lastPublish = now
        publish({
          state: expression.state, tracking: Boolean(head), fps: performanceMonitor.fps,
          reduced: performanceMonitor.reduced, particles: engine.count, impacts: engine.impacts,
          smile: expression.smile, open: expression.open, laugh: expression.laugh,
          inferenceMs, trackingHz: settings.trackingHz,
        })
      }
      raf = requestAnimationFrame(frame)
    } catch (error) {
      onError(error)
    }
  }

  raf = requestAnimationFrame(frame)
  return {
    stop() {
      stopped = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      pose?.close()
      pose = null
    },
    previewFireworks() { pendingPreview = true },
    setPreviewRain(value: boolean) { previewRain = value },
  }
}
