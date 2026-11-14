import { defaultTuning, reboundStarLimits } from './tuning.ts'
import type { Tuning } from './tuning.ts'

interface Slider {
  name: keyof Tuning
  label: string
  min: number
  max: number
  step?: number
  unit: string
}

const sections: { label: string; sliders: Slider[] }[] = [
  { label: '星雨', sliders: [
    { name: 'rainDensity', label: '雨量', min: 15, max: 160, unit: ' 颗/秒' },
    { name: 'rainSize', label: '五角星大小', min: 2, max: 10, step: 0.5, unit: ' px' },
    { name: 'rainTrail', label: '星雨拖尾', min: 12, max: 115, unit: ' px' },
    { name: 'rainLife', label: '生命周期', min: 0.6, max: 5, step: 0.1, unit: ' 秒' },
    { name: 'rainDirection', label: '下落方向', min: -65, max: 65, unit: '°' },
    { name: 'rainSpeed', label: '下落速度', min: 80, max: 460, unit: ' px/秒' },
  ] },
  { label: '烟花', sliders: [
    { name: 'fireworkSize', label: '烟花大小', min: 60, max: 190, unit: '%' },
    { name: 'fireworkPetals', label: '主烟花花瓣数量', min: 24, max: 120, unit: ' 片' },
    { name: 'fireworkPetalWidth', label: '烟花花瓣粗细', min: 30, max: 135, unit: '%' },
    { name: 'fireworkTrail', label: '烟花拖尾', min: 100, max: 600, unit: ' ms' },
    { name: 'reboundStarSize', label: '反弹小星大小', ...reboundStarLimits.size, unit: '%' },
    { name: 'reboundStarCount', label: '反弹小星数量', ...reboundStarLimits.count, unit: ' 颗' },
  ] },
  { label: '表情', sliders: [
    { name: 'smileSensitivity', label: '微笑灵敏度', min: 20, max: 100, unit: '%' },
    { name: 'laughSensitivity', label: '大笑灵敏度', min: 20, max: 100, unit: '%' },
  ] },
]

export function EffectControls({ tuning, onChange }: { tuning: Tuning; onChange: (value: Tuning) => void }) {
  return (
    <section className="controls" aria-label="特效调节">
      <div className="controls-heading">
        <h2>特效调节</h2>
        <button onClick={() => onChange(defaultTuning)}>恢复默认</button>
      </div>
      <div className="control-groups">
        {sections.map(({ label, sliders }) => (
          <fieldset key={label}>
            <legend>{label}</legend>
            {sliders.map(({ name, label: title, min, max, step = 1, unit }) => (
              <label key={name} className="slider">
                <span>{title}</span><output aria-hidden="true">{tuning[name]}{unit}</output>
                <input type="range" min={min} max={max} step={step} value={tuning[name]}
                  aria-label={title} aria-valuetext={`${tuning[name]}${unit}`}
                  onChange={(event) => onChange({ ...tuning, [name]: event.target.valueAsNumber })} />
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <p>星雨方向为 0° 时垂直下落，负值向左。烟花大小和花瓣数量在下次绽放时生效。反弹小星大小即时生效，数量按单次花瓣碰撞计算，性能降级时会减少。</p>
    </section>
  )
}
