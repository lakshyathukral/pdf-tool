// ---------------------------------------------------------------------------
// presets.js — saved sets of settings, kept in the browser.
//
// localStorage is a small store the browser keeps per website, on this machine
// only. Nothing is sent anywhere. It can throw — private windows, or a browser
// set to block site data — so every access is wrapped.
// ---------------------------------------------------------------------------

const PRESETS_KEY = 'pdf-tool.presets'
const LAST_USED_KEY = 'pdf-tool.last-used'

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

// { name -> settings }
export const listPresets = () => read(PRESETS_KEY, {})

export const presetNames = () => Object.keys(listPresets()).sort((a, b) => a.localeCompare(b))

export function savePreset(name, settings) {
  const all = listPresets()
  all[name] = settings
  return write(PRESETS_KEY, all)
}

export function deletePreset(name) {
  const all = listPresets()
  delete all[name]
  return write(PRESETS_KEY, all)
}

export const getPreset = (name) => listPresets()[name] ?? null

// The settings in use right now, remembered so a reload does not lose them.
// Separate from named presets: this one is overwritten constantly.
export const rememberLastUsed = (settings) => write(LAST_USED_KEY, settings)
export const recallLastUsed = () => read(LAST_USED_KEY, null)
