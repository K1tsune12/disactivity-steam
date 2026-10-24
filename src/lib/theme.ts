import { useSyncExternalStore } from "react"
import { Effect, getCurrentWindow } from "@tauri-apps/api/window"

export type Theme = "light" | "dark"
/** Windows window effects: Mica (Windows 11) or Acrylic (blurred glass) */
export type Translucency = "off" | "mica" | "acrylic"

const STORAGE_KEY = "disactivityTheme"
const TRANSLUCENCY_KEY = "disactivityTranslucency"

function initialTheme(): Theme {
    try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved === "light" || saved === "dark") return saved
    } catch {
        // Storage unavailable: follow the system
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

/** The .dark class drives the app colors; color-scheme makes native parts
 *  (scrollbars, inputs) follow the same theme */
function applyTheme(theme: Theme) {
    document.documentElement.classList.toggle("dark", theme === "dark")
    document.documentElement.style.colorScheme = theme
}

function initialTranslucency(): Translucency {
    try {
        const saved = localStorage.getItem(TRANSLUCENCY_KEY)
        if (saved === "mica" || saved === "acrylic") return saved
    } catch {
        // Storage unavailable: no effect
    }
    return "off"
}

/** The window is already transparent; the effect blurs what is behind it and the
 *  .translucent class makes the app background see-through enough to show it */
function applyTranslucency(translucency: Translucency) {
    document.documentElement.classList.toggle("translucent", translucency !== "off")
    const window = getCurrentWindow()
    const change = translucency === "off"
        ? window.clearEffects()
        : window.setEffects({ effects: [translucency === "mica" ? Effect.Mica : Effect.Acrylic] })
    change.catch(console.error)
}

let current = initialTheme()
let currentTranslucency = initialTranslucency()
applyTheme(current)
applyTranslucency(currentTranslucency)
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function setTheme(theme: Theme) {
    current = theme
    applyTheme(theme)
    try {
        localStorage.setItem(STORAGE_KEY, theme)
    } catch {
        // Keep the theme for this session even if it cannot be saved
    }
    listeners.forEach((listener) => listener())
}

/** App theme, shared by every component (toasts included) and saved between launches */
export function useTheme(): Theme {
    return useSyncExternalStore(subscribe, () => current)
}

export function setTranslucency(translucency: Translucency) {
    currentTranslucency = translucency
    applyTranslucency(translucency)
    try {
        localStorage.setItem(TRANSLUCENCY_KEY, translucency)
    } catch {
        // Keep it for this session even if it cannot be saved
    }
    listeners.forEach((listener) => listener())
}

export function useTranslucency(): Translucency {
    return useSyncExternalStore(subscribe, () => currentTranslucency)
}
