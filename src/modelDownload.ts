export async function downloadModel(url: string, signal: AbortSignal, idleMs = 15_000) {
  signal.throwIfAborted()
  const request = new AbortController()
  const cancel = () => request.abort(signal.reason)
  const expire = () => request.abort(new DOMException('Model download stopped making progress.', 'TimeoutError'))
  signal.addEventListener('abort', cancel, { once: true })
  let timer = setTimeout(expire, idleMs)
  try {
    const response = await fetch(url, { signal: request.signal })
    if (!response.ok) throw new Error(`Model HTTP ${response.status}`)
    if (!response.body) throw new Error('Model response has no body.')
    const progress = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, stream) {
        if (chunk.byteLength) {
          clearTimeout(timer)
          timer = setTimeout(expire, idleMs)
        }
        stream.enqueue(chunk)
      },
    })
    const reader = new Response(response.body.pipeThrough(progress, { signal: request.signal }))
    return new Uint8Array(await reader.arrayBuffer())
  } catch (error) {
    request.signal.throwIfAborted()
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
  }
}
