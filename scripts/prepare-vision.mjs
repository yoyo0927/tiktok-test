import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'

const assets = new URL('../public/vision/', import.meta.url)
const wasm = new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url)
const models = [
  ['face_landmarker.task', 'face_landmarker/face_landmarker', '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'],
  ['pose_landmarker_lite.task', 'pose_landmarker/pose_landmarker_lite', '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'],
]
const checksum = (bytes) => createHash('sha256').update(bytes).digest('hex')

await mkdir(assets, { recursive: true })
await cp(wasm, new URL('wasm/', assets), { recursive: true })

await Promise.all(models.map(async ([name, path, sha]) => {
  const file = new URL(name, assets)
  const cached = await readFile(file).catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (cached && checksum(cached) === sha) return
  console.log(`Downloading ${name}…`)
  const response = await fetch(`https://storage.googleapis.com/mediapipe-models/${path}/float16/1/${name}`, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`${name} download failed (HTTP ${response.status})`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (checksum(bytes) !== sha) throw new Error(`${name} checksum mismatch`)
  await writeFile(file, bytes)
}))
