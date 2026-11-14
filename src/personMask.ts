import type { MPMask } from '@mediapipe/tasks-vision'
import { coverBounds } from './geometry.ts'

export class PersonMask {
  private canvas = document.createElement('canvas')
  private context = this.canvas.getContext('2d')!
  private image: ImageData | null = null
  private confidence = new Float32Array(0)
  private available = false

  update(mask?: MPMask) {
    this.available = false
    if (!mask || !mask.width || !mask.height) return
    const scale = Math.min(1, 320 / Math.max(mask.width, mask.height))
    const width = Math.max(1, Math.round(mask.width * scale))
    const height = Math.max(1, Math.round(mask.height * scale))
    if (!this.image || this.image.width !== width || this.image.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
      this.image = this.context.createImageData(width, height)
      this.confidence = new Float32Array(width * height)
    }
    const source = mask.getAsFloat32Array()
    const xScale = mask.width / width
    const yScale = mask.height / height
    const confidence = this.confidence
    const pixels = this.image.data
    let foreground = false
    for (let y = 0; y < height; y++) {
      const row = Math.floor((y + 0.5) * yScale) * mask.width
      for (let x = 0; x < width; x++) confidence[y * width + x] = source[row + Math.floor((x + 0.5) * xScale)]
    }
    // Widen the mask slightly so thin details and the moving silhouette's edge stay in front.
    for (let y = 0; y < height; y++) {
      const above = Math.max(0, y - 1) * width
      const below = Math.min(height - 1, y + 1) * width
      for (let x = 0; x < width; x++) {
        const index = y * width + x
        const value = Math.max(confidence[index], confidence[above + x], confidence[below + x],
          confidence[y * width + Math.max(0, x - 1)], confidence[y * width + Math.min(width - 1, x + 1)])
        pixels[index * 4 + 3] = Math.min(255, Math.max(0, (value - 0.18) * 255 / 0.25))
        foreground ||= value >= 0.43
      }
    }
    if (!foreground) return
    this.context.putImageData(this.image, 0, 0)
    this.available = true
  }

  erase(ctx: CanvasRenderingContext2D, width: number, height: number, video: HTMLVideoElement, mirrored: boolean) {
    if (!this.available || !video.videoWidth || !video.videoHeight) return false
    const { w, h, left, top } = coverBounds(width, height, video.videoWidth, video.videoHeight)
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.globalAlpha = 1
    if (mirrored) {
      ctx.translate(width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(this.canvas, left, top, w, h)
    ctx.restore()
    return true
  }

  project(width: number, height: number, video: HTMLVideoElement, mirrored: boolean) {
    const image = this.available ? this.image : null
    if (!image || !video.videoWidth || !video.videoHeight || width <= 0 || height <= 0) return undefined
    const { w, h, left, top } = coverBounds(width, height, video.videoWidth, video.videoHeight)
    return (x: number, y: number) => {
      const u = (x - left) / w
      const px = Math.min(image.width - 1, Math.floor((mirrored ? 1 - u : u) * image.width))
      const py = Math.min(image.height - 1, Math.floor((y - top) / h * image.height))
      return px >= 0 && py >= 0 && u >= 0 && u <= 1 && y <= top + h && image.data[(py * image.width + px) * 4 + 3] > 48
    }
  }
}
