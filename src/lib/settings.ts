import { useSyncExternalStore } from "react"
import { DEFAULT_SOUND } from "@/lib/sound"

export type TimerEndAction = "none" | "stop" | "stopAndClose"

export interface AppSettings {
    /** Show the quest progress bar on running games */
    questTimerEnabled: boolean
    /** Selected quest timer length, from QUEST_TIMER_OPTIONS or customTimerOptions */
    questTimerMinutes: number
    /** Timer lengths added by the user, saved and listed after the built-in ones */
    customTimerOptions: number[]
    /** Windows notification when the quest timer ends */
    notifyOnTimerEnd: boolean
    /** Play a sound when the quest timer ends */
    soundOnTimerEnd: boolean
    /** A preset file from C:\Windows\Media or the full path of a .wav picked by the user */
    timerSound: string
    timerEndAction: TimerEndAction
    /** Minutes used by the "close Disactivity after" schedule */
    autoCloseMinutes: number
    /** Keep the fake game windows out of the taskbar and Alt+Tab */
    hideGameWindows: boolean
    /** The close button hides the app to the system tray instead of quitting */
    closeToTray: boolean
    /** Time (ms) when the app closes itself. Only for this session, never saved */
    autoCloseAt: number | null
}

export const QUEST_TIMER_OPTIONS = [15, 30, 45, 60]
export const MAX_MINUTES = 24 * 60

const STORAGE_KEY = "disactivitySettings"
const DEFAULT_SETTINGS: AppSettings = {
    questTimerEnabled: true,
    questTimerMinutes: 15,
    customTimerOptions: [],
    notifyOnTimerEnd: true,
    soundOnTimerEnd: true,
    timerSound: DEFAULT_SOUND,
    timerEndAction: "none",
    autoCloseMinutes: 60,
    hideGameWindows: false,
    closeToTray: false,
    autoCloseAt: null,
}

function readSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
            const saved = JSON.parse(raw)
            // Older test builds stored a boolean instead of the action
            if (saved.stopOnTimerEnd && !saved.timerEndAction) saved.timerEndAction = "stop"
            delete saved.stopOnTimerEnd
            return { ...DEFAULT_SETTINGS, ...saved, autoCloseAt: null }
        }
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
        const persisted: Partial<AppSettings> = { ...current }
        delete persisted.autoCloseAt
        localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
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

/** Add a user timer length to the saved list and select it */
export function addCustomTimerOption(minutes: number) {
    const options = current.customTimerOptions
    const customTimerOptions = QUEST_TIMER_OPTIONS.includes(minutes) || options.includes(minutes)
        ? options
        : [...options, minutes].sort((a, b) => a - b)
    setSettings({ customTimerOptions, questTimerMinutes: minutes })
}

/** Remove a user timer length; if it was selected, go back to the default */
export function removeCustomTimerOption(minutes: number) {
    setSettings({
        customTimerOptions: current.customTimerOptions.filter((m) => m !== minutes),
        questTimerMinutes: current.questTimerMinutes === minutes ? DEFAULT_SETTINGS.questTimerMinutes : current.questTimerMinutes,
    })
}

/** Parse a minutes field, keeping it between 1 and MAX_MINUTES */
export function parseMinutes(value: string): number | null {
    const minutes = Math.round(Number(value))
    if (!Number.isFinite(minutes) || minutes < 1) return null
    return Math.min(minutes, MAX_MINUTES)
}
