import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"

/** Built-in choices, all from C:\Windows\Media so nothing has to ship with the app */
export const SOUND_PRESETS = [
    { id: "calendar", file: "Windows Notify Calendar.wav" },
    { id: "notify", file: "Windows Notify System Generic.wav" },
    { id: "message", file: "Windows Notify Messaging.wav" },
    { id: "tada", file: "tada.wav" },
    { id: "chimes", file: "chimes.wav" },
    { id: "alarm", file: "Alarm01.wav" },
    { id: "ring", file: "Ring06.wav" },
] as const

export const DEFAULT_SOUND = SOUND_PRESETS[0].file

export function findSoundPreset(sound: string) {
    return SOUND_PRESETS.find((preset) => preset.file === sound)
}

/** File name shown for a sound picked by the user */
export function soundFileName(sound: string): string {
    return sound.split(/[\\/]/).pop() || sound
}

/** A preset file name or the full path of a .wav file */
export function playSound(sound: string): Promise<void> {
    return invoke("play_sound", { sound })
}

export async function pickSoundFile(): Promise<string | null> {
    const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "WAV", extensions: ["wav"] }],
    })
    return typeof selected === "string" ? selected : null
}
