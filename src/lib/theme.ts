import { useSyncExternalStore } from "react"
import { Effect, getCurrentWindow } from "@tauri-apps/api/window"

export type Theme = "light" | "dark"
/** off: solid background. glass: the desktop shows through, sharp (the original app look).
 *  mica / acrylic: Windows window effects (Mica needs Windows 11, Acrylic is blurred glass) */
export type Translucency = "off" | "glass" | "mica" | "acrylic"

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
        if (saved === "glass" || saved === "mica" || saved === "acrylic") return saved
        // In 1.2.0 "off" still showed the desktop through the window, which is now "glass";
        // a solid background is saved as "solid" so old "off" choices keep their look
        if (saved === "solid") return "off"
    } catch {
        // Storage unavailable: original look
    }
    return "glass"
}

/** The window is already transparent; the effect blurs what is behind it and the
 *  .translucent class makes the app background see-through enough to show it */
function applyTranslucency(translucency: Translucency) {
    const effect = translucency === "mica" || translucency === "acrylic"
    document.documentElement.classList.toggle("translucent", effect)
    document.documentElement.classList.toggle("opaque", translucency === "off")
    const window = getCurrentWindow()
    const change = !effect
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
        localStorage.setItem(TRANSLUCENCY_KEY, translucency === "off" ? "solid" : translucency)
    } catch {
        // Keep it for this session even if it cannot be saved
    }
    listeners.forEach((listener) => listener())
}

export function useTranslucency(): Translucency {
    return useSyncExternalStore(subscribe, () => currentTranslucency)
}
