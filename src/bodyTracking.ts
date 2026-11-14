import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { Capsule, BodyRegion } from './bodyRegion.ts'
import { estimateBody } from './bodyRegion.ts'
import { coverProjection } from './geometry.ts'
import type { Ellipse } from './geometry.ts'

export async function createBodyTracker(signal: AbortSignal) {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
  const assets = `${import.meta.env.BASE_URL}vision/`
  const [vision, response] = await Promise.all([
    FilesetResolver.forVisionTasks(`${assets}wasm`),
    fetch(`${assets}pose_landmarker_lite.task`, { signal }),
  ])
  if (!response.ok) throw new Error(`Pose model HTTP ${response.status}`)
  const modelAssetBuffer = new Uint8Array(await response.arrayBuffer())
  signal.throwIfAborted()
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetBuffer, delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: true,
  })
}

export function projectBody(points: NormalizedLandmark[] | undefined, width: number, height: number,
  video: HTMLVideoElement, mirrored: boolean, head: Ellipse | null): BodyRegion {
  if (!points || !video.videoWidth || !video.videoHeight) return estimateBody(head, height)
  const project = coverProjection(width, height, video.videoWidth, video.videoHeight, mirrored)
  const point = (index: number) => points[index]?.visibility > 0.45 ? project(points[index]) : null
  const left = point(11)
  const right = point(12)
  if (!left || !right) return estimateBody(head, height)
  const shoulders = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }
  const span = Math.max(head ? head.rx * 2.1 : 25, Math.hypot(left.x - right.x, left.y - right.y))
  const hipLeft = point(23)
  const hipRight = point(24)
  const hips = hipLeft && hipRight ? { x: (hipLeft.x + hipRight.x) / 2, y: (hipLeft.y + hipRight.y) / 2 }
    : { x: shoulders.x, y: Math.max(height, shoulders.y) }
  const body: Capsule[] = [
    { from: shoulders, to: hips, radius: span * 0.48 + 12 },
    { from: left, to: right, radius: span * 0.17 + 10 },
  ]
  for (const [start, end] of [[11, 13], [12, 14], [13, 15], [14, 16], [15, 19], [16, 20], [23, 25], [24, 26], [25, 27], [26, 28]]) {
    const from = point(start)
    const to = point(end)
    if (from && to) body.push({ from, to, radius: span * (start >= 23 ? 0.16 : 0.11) + 10 })
  }
  return body
}
