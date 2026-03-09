const PROVIDER_PROFILES_CHANGED_EVENT = 'holycrab:provider-profiles-changed'

let providerProfilesVersion = 0

export function getProviderProfilesVersion() {
  return providerProfilesVersion
}

export function markProviderProfilesChanged() {
  providerProfilesVersion += 1
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PROVIDER_PROFILES_CHANGED_EVENT))
}

export function subscribeProviderProfilesChanged(listener: () => void) {
  if (typeof window === 'undefined') {
    return () => {}
  }
  window.addEventListener(PROVIDER_PROFILES_CHANGED_EVENT, listener)
  return () => {
    window.removeEventListener(PROVIDER_PROFILES_CHANGED_EVENT, listener)
  }
}
