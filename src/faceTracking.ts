import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { coverProjection } from './geometry.ts'
import type { Ellipse, Point } from './geometry.ts'
import type { Scores } from './expression.ts'
import { downloadModel } from './modelDownload.ts'

export interface FaceFrame {
  scores: Scores
  forehead: Point
  chin: Point
  cheekLeft: Point
  cheekRight: Point
}

export async function createTracker(signal: AbortSignal) {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
  const assets = `${import.meta.env.BASE_URL}vision/`
  const [vision, modelAssetBuffer] = await Promise.all([
    FilesetResolver.forVisionTasks(`${assets}wasm`),
    downloadModel(`${assets}face_landmarker.task`, signal),
  ])
  const create = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetBuffer, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
  })

  signal.throwIfAborted()
  try {
    return { model: await create('GPU'), delegate: 'GPU' }
  } catch (error) {
    signal.throwIfAborted()
    console.info('MediaPipe GPU unavailable; using CPU.', error)
    return { model: await create('CPU'), delegate: 'CPU' }
  }
}

export function trackFace(model: FaceLandmarker, video: HTMLVideoElement, now: number): FaceFrame | null {
  const { faceLandmarks, faceBlendshapes } = model.detectForVideo(video, now)
  const points = faceLandmarks[0]
  if (!points || points.length < 468) return null
  const pixelDistance = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(
    (a.x - b.x) * video.videoWidth,
    (a.y - b.y) * video.videoHeight,
  )
  const opening = pixelDistance(points[13], points[14]) / Math.max(1, pixelDistance(points[61], points[291]))
  const openingScore = Math.min(1, Math.max(0, (opening - 0.05) / 0.44))
  const categories = faceBlendshapes[0]?.categories ?? []
  const left = categories.find((entry) => entry.categoryName === 'mouthSmileLeft')?.score ?? 0
  const right = categories.find((entry) => entry.categoryName === 'mouthSmileRight')?.score ?? 0
  const jaw = categories.find((entry) => entry.categoryName === 'jawOpen')?.score ?? openingScore

  return {
    scores: { smile: (left + right) * 0.5, open: 0.55 * jaw + 0.45 * openingScore },
    forehead: points[10], chin: points[152], cheekLeft: points[234], cheekRight: points[454],
  }
}

export function projectHead(face: FaceFrame, width: number, height: number, video: HTMLVideoElement, mirrored: boolean): Ellipse | null {
  if (!video.videoWidth || !video.videoHeight || !width || !height) return null
  const project = coverProjection(width, height, video.videoWidth, video.videoHeight, mirrored)
  const forehead = project(face.forehead)
  const chin = project(face.chin)
  const left = project(face.cheekLeft)
  const right = project(face.cheekRight)
  const dx = chin.x - forehead.x
  const dy = chin.y - forehead.y
  const faceHeight = Math.hypot(dx, dy)
  if (faceHeight < 12) return null
  return {
    x: forehead.x + dx * 0.40,
    y: forehead.y + dy * 0.40,
    rx: Math.max(faceHeight * 0.26, Math.hypot(right.x - left.x, right.y - left.y) * 0.55),
    ry: faceHeight * 0.62,
    angle: Math.atan2(-dx, dy),
  }
}
