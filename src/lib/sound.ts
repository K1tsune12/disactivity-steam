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

/** Formats played by the web view; .wav and the Windows presets use the Windows player */
const WEB_AUDIO_TYPES: Record<string, string> = {
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    webm: "audio/webm",
}

export const SOUND_FILE_EXTENSIONS = ["wav", ...Object.keys(WEB_AUDIO_TYPES)]

let playing: HTMLAudioElement | null = null

/** A preset file name or the full path of an audio file */
export async function playSound(sound: string): Promise<void> {
    const extension = sound.split(".").pop()?.toLowerCase() ?? ""
    const type = WEB_AUDIO_TYPES[extension]
    if (!type) {
        return invoke("play_sound", { sound })
    }

    const bytes = await invoke<ArrayBuffer>("read_sound_file", { path: sound })
    const url = URL.createObjectURL(new Blob([bytes], { type }))
    playing?.pause()
    const audio = new Audio(url)
    playing = audio
    audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true })
    await audio.play()
}

export async function pickSoundFile(): Promise<string | null> {
    const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Audio", extensions: SOUND_FILE_EXTENSIONS }],
    })
    return typeof selected === "string" ? selected : null
}
