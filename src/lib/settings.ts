import { useSyncExternalStore } from "react"

export interface AppSettings {
    /** Show the quest progress bar on running games */
    questTimerEnabled: boolean
    questTimerMinutes: number
    /** Windows notification when the quest timer ends */
    notifyOnTimerEnd: boolean
    /** Stop the game when the quest timer ends */
    stopOnTimerEnd: boolean
    /** Keep the fake game windows out of the taskbar and Alt+Tab */
    hideGameWindows: boolean
    /** The close button hides the app to the system tray instead of quitting */
    closeToTray: boolean
}

export const QUEST_TIMER_OPTIONS = [15, 30, 45, 60]

const STORAGE_KEY = "disactivitySettings"
const DEFAULT_SETTINGS: AppSettings = {
    questTimerEnabled: true,
    questTimerMinutes: 15,
    notifyOnTimerEnd: true,
    stopOnTimerEnd: false,
    hideGameWindows: false,
    closeToTray: false,
}

function readSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    } catch {
        // Storage unavailable or corrupted: fall back to the defaults
    }
    return DEFAULT_SETTINGS
}

let current = readSettings()
const listeners = new Set<() => void>()

export function getSettings(): AppSettings {
    return current
}

export function setSettings(update: Partial<AppSettings>) {
    current = { ...current, ...update }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
    } catch {
        // Keep the setting for this session even if it cannot be saved
    }
    listeners.forEach((listener) => listener())
}

export function useSettings(): AppSettings {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        () => current
    )
}
