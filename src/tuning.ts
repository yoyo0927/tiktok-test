export const defaultTuning = {
  rainDensity: 110,
  rainSize: 5,
  rainTrail: 78,
  rainLife: 3.6,
  rainDirection: -12,
  rainSpeed: 331,
  fireworkSize: 91,
  fireworkPetals: 120,
  fireworkPetalWidth: 100,
  fireworkTrail: 515,
  smileSensitivity: 60,
  laughSensitivity: 82,
}

export type Tuning = typeof defaultTuning

const storageKey = 'live-reactions-tuning'

export function loadTuning(): Tuning {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<Tuning> | null
    const tuning = { ...defaultTuning }
    for (const key of Object.keys(tuning) as (keyof Tuning)[]) {
      const value = stored?.[key]
      if (typeof value === 'number' && Number.isFinite(value)) tuning[key] = value
    }
    return tuning
  } catch {
    return defaultTuning
  }
}

export function saveTuning(tuning: Tuning) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(tuning))
  } catch {
    // Adjustments still apply in the current session when storage is unavailable.
  }
}
