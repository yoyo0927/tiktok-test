export async function openCamera(video: HTMLVideoElement, signal: AbortSignal, onEnded: () => void) {
  if (!window.isSecureContext) throw new Error('摄像头需要 HTTPS 或 localhost。')
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('浏览器不支持摄像头访问，请使用新版 Chrome、Edge 或 Safari。')

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
  })
  const tracks = stream.getTracks()
  const stop = () => {
    for (const track of tracks) {
      track.removeEventListener('ended', onEnded)
      track.stop()
    }
    if (video.srcObject === stream) video.srcObject = null
  }

  if (signal.aborted) {
    stop()
    throw signal.reason
  }
  signal.addEventListener('abort', stop, { once: true })
  for (const track of tracks) track.addEventListener('ended', onEnded, { once: true })
  video.srcObject = stream
  try {
    await video.play()
    return { mirrored: stream.getVideoTracks()[0]?.getSettings().facingMode !== 'environment' }
  } catch (error) {
    stop()
    throw error
  }
}

export function cameraError(error: unknown) {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError': return '摄像头权限被拒绝。请在浏览器站点设置里允许摄像头，再重试。'
      case 'NotFoundError': return '未找到摄像头。请连接摄像头，再重试。'
      case 'NotReadableError': return '摄像头无法启动。请检查系统权限，并关闭可能占用摄像头的应用。'
      case 'SecurityError': return '当前页面禁止访问摄像头。请在浏览器中直接打开页面。'
    }
  }
  return error instanceof Error && !(error instanceof DOMException) ? error.message : '摄像头启动失败，请重试。'
}
