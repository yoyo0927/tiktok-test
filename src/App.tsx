import { useEffect, useRef, useState } from 'react'
import { cameraError, openCamera } from './camera.ts'
import { createTracker } from './faceTracking.ts'
import { initialTelemetry, runSession } from './session.ts'
import { EffectControls } from './EffectControls.tsx'
import { loadTuning, saveTuning } from './tuning.ts'
import type { Tuning } from './tuning.ts'

type Status = 'idle' | 'permission' | 'loading' | 'running' | 'error'
const stateLabels = { neutral: '自然', smile: '微笑', laugh: '大笑' }

export function App() {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const active = useRef<AbortController | null>(null)
  const runtime = useRef<ReturnType<typeof runSession> | null>(null)
  const effectsOnly = useRef(false)
  const debugRef = useRef(false)
  const [debug, setDebug] = useState(false)
  const [portrait, setPortrait] = useState(false)
  const [tuning, setTuning] = useState(loadTuning)
  const tuningRef = useRef(tuning)
  const [previewing, setPreviewing] = useState(false)
  const [previewRain, setPreviewRain] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [mirrored, setMirrored] = useState(true)
  const [message, setMessage] = useState('')
  const [telemetry, setTelemetry] = useState(initialTelemetry)

  useEffect(() => () => {
    active.current?.abort()
    runtime.current?.stop()
  }, [])

  function stopPreview() {
    runtime.current?.setPreviewRain(false)
    setPreviewRain(false)
    if (!effectsOnly.current) return
    runtime.current?.stop()
    runtime.current = null
    effectsOnly.current = false
    setPreviewing(false)
    setTelemetry(initialTelemetry)
  }

  function stop() {
    stopPreview()
    active.current?.abort()
    active.current = null
    setTelemetry(initialTelemetry)
    setStatus('idle')
  }

  async function start() {
    if (active.current || !video.current || !canvas.current) return
    stopPreview()
    const camera = video.current
    const overlay = canvas.current
    const controller = new AbortController()
    const { signal } = controller
    active.current = controller
    setTelemetry(initialTelemetry)
    setStatus('permission')
    let cameraReady = false

    const fail = (text: string) => {
      if (active.current !== controller) return
      controller.abort()
      active.current = null
      setPreviewRain(false)
      setMessage(text)
      setStatus('error')
    }

    try {
      const options = await openCamera(camera, signal, () => fail('摄像头已断开。请重新连接后再试。'))
      if (signal.aborted) return
      cameraReady = true
      setMirrored(options.mirrored)
      setStatus('loading')
      const { model } = await createTracker(signal)
      if (signal.aborted) {
        model.close()
        return
      }
      signal.addEventListener('abort', () => {
        runtime.current?.stop()
        runtime.current = null
        model.close()
      }, { once: true })
      runtime.current = runSession(camera, overlay, model, options.mirrored, () => debugRef.current, () => tuningRef.current, setTelemetry, (error) => {
        console.error('Face tracking stopped.', error)
        fail('人脸追踪中断。请重试，或使用新版 Chrome、Edge 或 Safari。')
      }, signal)
      setStatus('running')
    } catch (error) {
      if (signal.aborted) return
      if (cameraReady) console.error('Could not start face tracking.', error)
      fail(cameraReady ? '人脸追踪启动失败。请检查网络并重试，或使用新版 Chrome、Edge 或 Safari。' : cameraError(error))
    }
  }

  function changeMode(value: boolean) {
    if (!value) stopPreview()
    debugRef.current = value
    setDebug(value)
  }

  function changeTuning(value: Tuning) {
    tuningRef.current = value
    setTuning(value)
    saveTuning(value)
  }

  function preview(effect: 'rain' | 'fireworks') {
    if (!runtime.current && !active.current && video.current && canvas.current) {
      const fail = (error: unknown) => {
        stopPreview()
        setMessage(error instanceof Error ? error.message : '特效预览启动失败。')
        setStatus('error')
      }
      try {
        runtime.current = runSession(video.current, canvas.current, null, true, () => debugRef.current,
          () => tuningRef.current, setTelemetry, fail)
        effectsOnly.current = true
        setPreviewing(true)
      } catch (error) {
        fail(error)
        return
      }
    }
    if (effect === 'fireworks') runtime.current?.previewFireworks()
    else {
      runtime.current?.setPreviewRain(!previewRain)
      setPreviewRain(!previewRain)
    }
  }

  const running = status === 'running'
  const loading = status === 'permission' || status === 'loading'
  const visibleVideo = running || status === 'loading'

  return (
    <main className="shell" data-portrait={portrait} data-debug={debug}>
      <header className="topbar">
        <h1>Live Reactions<span>AR</span></h1>
        <div className="toolbar">
          <button className="portrait-toggle" aria-pressed={portrait} onClick={() => setPortrait(!portrait)}>手机竖屏</button>
          <div className="modes" role="group" aria-label="显示模式">
            <button aria-pressed={!debug} onClick={() => changeMode(false)}>演示</button>
            <button aria-pressed={debug} onClick={() => changeMode(true)}>调试</button>
          </div>
        </div>
      </header>

      <section className="stage" aria-label="实时 AR 预览">
        <video ref={video} muted playsInline className={mirrored ? 'mirrored' : ''} data-visible={visibleVideo} />
        <canvas ref={canvas} hidden={!running && !previewing} aria-hidden="true" />
        {running ? (
          <div className="stage-bar">
            <span className="status" data-state={telemetry.tracking ? telemetry.state : 'searching'}>
              <span />{telemetry.tracking ? stateLabels[telemetry.state] : '寻找人脸'}
            </span>
            <button onClick={stop}>关闭摄像头</button>
          </div>
        ) : previewing ? (
          <div className="stage-bar">
            <span className="status">特效预览</span>
            <button onClick={start}>开启摄像头</button>
          </div>
        ) : (
          <div className="placeholder">
            <p role={status === 'error' ? 'alert' : 'status'}>
              {status === 'error' ? message : status === 'permission' ? '等待摄像头权限…'
                : status === 'loading' ? '正在加载人脸追踪…' : '微笑唤起星雨，大笑点亮烟花。'}
            </p>
            <button className="primary" onClick={loading ? stop : start}>
              {loading ? '取消' : status === 'error' ? '重试' : '开启摄像头'}
            </button>
          </div>
        )}
      </section>

      {debug && (
        <div className="settings">
        <section className="debug" aria-label="调试数据">
          <div className="debug-top">
            <p>开启摄像头后，青色虚线标出头部。花瓣撞到轮廓时会散成几颗小星。</p>
            <div className="preview-actions">
              <button aria-pressed={previewRain} disabled={loading} onClick={() => preview('rain')}>预览星雨</button>
              <button disabled={loading} onClick={() => preview('fireworks')}>试放烟花</button>
            </div>
          </div>
          <dl>
            <div><dt>FPS</dt><dd>{telemetry.fps || '—'}</dd></div>
            <div><dt>状态</dt><dd>{telemetry.tracking ? telemetry.state : '—'}</dd></div>
            <div><dt>Smile</dt><dd>{telemetry.smile.toFixed(2)}</dd></div>
            <div><dt>Laugh</dt><dd>{telemetry.laugh.toFixed(2)}</dd></div>
            <div><dt>张嘴</dt><dd>{telemetry.open.toFixed(2)}</dd></div>
            <div><dt>粒子</dt><dd>{telemetry.particles}</dd></div>
            <div><dt>碰撞</dt><dd>{telemetry.impacts}</dd></div>
            <div><dt>降级</dt><dd>{telemetry.reduced ? '开启' : '关闭'}</dd></div>
            <div><dt>推理</dt><dd>{running ? `${telemetry.inferenceMs.toFixed(1)} ms` : '—'}</dd></div>
            <div><dt>推理上限</dt><dd>{running ? `${telemetry.trackingHz} Hz` : '—'}</dd></div>
          </dl>
        </section>
        <EffectControls tuning={tuning} onChange={changeTuning} />
        </div>
      )}
      {!debug && <p className="hint">{running ? '请让整张脸进入画面。' : '摄像头画面仅在本机浏览器中处理。'}</p>}
    </main>
  )
}
