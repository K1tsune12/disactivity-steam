import { useSyncExternalStore } from "react"

export interface QuestTimerSettings {
    enabled: boolean
    minutes: number
}

export const QUEST_TIMER_OPTIONS = [15, 30, 45, 60]

const STORAGE_KEY = "disactivityQuestTimer"
const DEFAULT_SETTINGS: QuestTimerSettings = { enabled: true, minutes: 15 }

function readSettings(): QuestTimerSettings {
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

export function setQuestTimer(update: Partial<QuestTimerSettings>) {
    current = { ...current, ...update }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
    } catch {
        // Keep the setting for this session even if it cannot be saved
    }
    listeners.forEach((listener) => listener())
}

/** Quest timer shown on running games, shared by the game cards and the task manager */
export function useQuestTimer(): QuestTimerSettings {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        () => current
    )
}
