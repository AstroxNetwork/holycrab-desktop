export type SettingsWindowTarget = 'dictation' | 'updates'

export function openSettingsWindow(target?: SettingsWindowTarget) {
  const tabQuery = target ? `?tab=${encodeURIComponent(target)}` : ''
  window.location.hash = `#/settings${tabQuery}`
  return Promise.resolve()
}
