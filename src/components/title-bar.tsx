"use client"

import React, { useEffect, useState, useRef } from "react"
import { useTranslation } from "react-i18next"
import {
    Minus,
    Square,
    X,
    Sun,
    Moon,
    ArrowDownToLine,
    RotateCw,
    Loader2,
    Activity,
    StopCircle,
    SquareActivity,
    Settings,
    Languages,
    Timer,
    AppWindow,
} from "lucide-react"

import { getCurrentWindow } from "@tauri-apps/api/window"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, Update } from "@tauri-apps/plugin-updater"
import { Button } from "@/components/ui/button.tsx"
import { toast } from "sonner"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Game } from "@/components/game-card"
import { QUEST_TIMER_OPTIONS, getSettings, setSettings, useSettings } from "@/lib/settings"

type UpdateState = "idle" | "checking" | "available" | "downloading" | "ready" | "error"
type SupportedLanguage = "pt-BR" | "en-US" | "es-ES"

function getSupportedLanguage(language: string): SupportedLanguage {
    const baseLanguage = language.toLowerCase().split("-")[0]
    if (baseLanguage === "pt") return "pt-BR"
    if (baseLanguage === "es") return "es-ES"
    return "en-US"
}

interface RunningGameInfo {
    game: Game
    isLoading: boolean
    startTime: number
}

interface TitleBarProps {
    runningGames?: Map<string, RunningGameInfo>
    onStopGame?: (gameId: string) => void
}

export function TitleBar({ runningGames = new Map(), onStopGame }: TitleBarProps) {
    const { t, i18n } = useTranslation()
    const currentLanguage = getSupportedLanguage(i18n.resolvedLanguage || i18n.language)
    const settings = useSettings()
    const questTimerMs = settings.questTimerMinutes * 60 * 1000
    const [isHovered, setIsHovered] = useState(false)
    const [isDark, setIsDark] = useState(false)
    const [, setTick] = useState(0)

    // Tick every second to update elapsed times in the task manager
    useEffect(() => {
        if (runningGames.size === 0) return
        const interval = setInterval(() => setTick((t) => t + 1), 1000)
        return () => clearInterval(interval)
    }, [runningGames.size])

    const [updateState, setUpdateState] = useState<UpdateState>("idle")
    const [updateVersion, setUpdateVersion] = useState<string>("")
    const [downloadProgress, setDownloadProgress] = useState(0)
    const updateRef = useRef<Update | null>(null)
    const pendingUpdateRef = useRef<boolean>(false)

    const handleMinimize = async () => {
        const window = getCurrentWindow()
        await window.minimize()
    }

    const handleMaximize = async () => {
        const window = getCurrentWindow()
        const isMaximized = await window.isMaximized()
        if (isMaximized) {
            await window.unmaximize()
        } else {
            await window.maximize()
        }
    }

    const handleClose = async () => {
        // If there's a pending update, install it silently before closing
        if (pendingUpdateRef.current && updateRef.current) {
            try {
                await updateRef.current.install()
            } catch (error) {
                console.error("Failed to install update on close:", error)
            }
        }
        const window = getCurrentWindow()
        if (getSettings().closeToTray) {
            await window.hide()
            return
        }
        await window.close()
    }

    useEffect(() => {
        const darkModePreference = window.matchMedia("(prefers-color-scheme: dark)").matches
        setIsDark(darkModePreference)
        if (darkModePreference) {
            document.documentElement.classList.add("dark")
        }

        // Check for updates on boot (releases of this fork, see tauri.conf.json)
        checkForUpdates().catch(console.error)
    }, [])

    // Only an explicit choice is saved; otherwise the system language is used
    const handleLanguageChange = (language: string) => {
        i18n.services.languageDetector?.cacheUserLanguage?.(language, ["localStorage"])
        i18n.changeLanguage(language).catch(console.error)
    }

    useEffect(() => {
        document.documentElement.lang = currentLanguage
    }, [currentLanguage])

    const toggleTheme = () => {
        setIsDark(!isDark)
        document.documentElement.classList.toggle("dark")
    }

    const checkForUpdates = async () => {
        setUpdateState("checking")

        try {
            const update = await check()

            if (update) {
                updateRef.current = update
                setUpdateVersion(update.version)
                setUpdateState("available")

                toast(t("toast.updateAvailable.title"), {
                    description: t("toast.updateAvailable.description", { version: update.version }),
                })
            } else {
                setUpdateState("idle")
            }
        } catch (error) {
            console.error("Update check failed:", error)
            setUpdateState("idle")
            // Don't show error toast on boot - just silently fail
        }
    }

    const downloadAndInstallUpdate = async () => {
        if (!updateRef.current) return

        setUpdateState("downloading")
        setDownloadProgress(0)

        try {
            let downloaded = 0
            let contentLength = 0

            await updateRef.current.downloadAndInstall((event) => {
                switch (event.event) {
                    case "Started":
                        contentLength = event.data.contentLength || 0
                        break
                    case "Progress":
                        downloaded += event.data.chunkLength
                        if (contentLength > 0) {
                            const progress = Math.round((downloaded / contentLength) * 100)
                            setDownloadProgress(progress)
                        }
                        break
                    case "Finished":
                        setDownloadProgress(100)
                        break
                }
            })

            setUpdateState("ready")
            pendingUpdateRef.current = true

            toast.success(t("toast.updateReady.title"), {
                description: t("toast.updateReady.description", { version: updateVersion }),
                action: {
                    label: t("updater.restart"),
                    onClick: () => restartApp(),
                },
                duration: 10000,
            })
        } catch (error) {
            console.error("Download failed:", error)
            setUpdateState("error")
            toast.error(t("toast.updateError.title"), {
                description: t("toast.updateError.description", { error: String(error) }),
            })
        }
    }

    const restartApp = async () => {
        try {
            await relaunch()
        } catch (error) {
            console.error("Relaunch failed:", error)
            toast.error(t("toast.updateError.title"), {
                description: t("toast.updateError.description", { error: String(error) }),
            })
        }
    }

    const handleUpdateButtonClick = () => {
        switch (updateState) {
            case "available":
                downloadAndInstallUpdate().catch(console.error)
                break
            case "ready":
                restartApp().catch(console.error)
                break
            case "error":
                checkForUpdates().catch(console.error)
                break
        }
    }

    const getUpdateButtonContent = () => {
        switch (updateState) {
            case "checking":
                return <Loader2 className="h-5 w-5 animate-spin" />
            case "available":
                return <ArrowDownToLine className="h-5 w-5 text-green-400" />
            case "downloading":
                return (
                    <div className="relative h-5 w-5">
                        <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold">
                            {downloadProgress}
                        </span>
                    </div>
                )
            case "ready":
                return <RotateCw className="h-5 w-5 text-green-400" />
            case "error":
                return <ArrowDownToLine className="h-5 w-5 text-red-400" />
            default:
                return null
        }
    }

    const getUpdateTooltip = () => {
        switch (updateState) {
            case "checking":
                return t("toast.updateAvailable.title")
            case "available":
                return t("updater.tooltip")
            case "downloading":
                return `${t("updater.downloading")} ${downloadProgress}%`
            case "ready":
                return t("updater.restart")
            case "error":
                return t("toast.updateError.title")
            default:
                return ""
        }
    }

    const showUpdateButton = updateState !== "idle"
    const runningGamesArray = Array.from(runningGames.values())
    const runningCount = runningGamesArray.length

    const formatElapsedTime = (ms: number): string => {
        const totalSeconds = Math.floor(ms / 1000)
        const hours = Math.floor(totalSeconds / 3600)
        const minutes = Math.floor((totalSeconds % 3600) / 60)
        const seconds = totalSeconds % 60
        const pad = (n: number) => n.toString().padStart(2, "0")
        if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
        return `${pad(minutes)}:${pad(seconds)}`
    }

    const getGameIconUrl = (game: Game, size: number = 64): string => {
        if (game.icon_hash) {
            return `https://cdn.discordapp.com/app-icons/${game.id}/${game.icon_hash}.png?size=${size}&keep_aspect_ratio=false`
        }
        return "https://cdn.discordapp.com/embed/avatars/0.png"
    }

    return (
        <header
            data-tauri-drag-region
            className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between h-10 px-4 bg-background/80 backdrop-blur-xl border-b border-border/50 select-none max-sm:px-2"
        >
            {/* Title */}
            <div className="flex items-center gap-2 flex-1 min-w-0" data-tauri-drag-region>
                <img className="h-5 w-5 pointer-events-none" src="./icon.png" alt="App icon"/>
                <span className="font-semibold text-sm text-foreground pointer-events-none truncate max-sm:hidden">Disactivity Steam</span>
            </div>

            <div
                className="flex items-center gap-2 relative z-10 max-sm:gap-1"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                style={{WebkitAppRegion: 'no-drag'} as React.CSSProperties}
            >
                {/* Running Games Task Manager */}
                {runningCount > 0 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="secondary" size="sm" className="h-8 gap-1.5 px-2 max-sm:h-7 max-sm:px-1.5">
                                <SquareActivity className="h-4 w-4 text-green-500" />
                                <span className="text-xs font-medium">{runningCount}</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-72">
                            <DropdownMenuLabel className="flex items-center gap-2">
                                <Activity className="h-4 w-4 text-green-500" />
                                {t("taskManager.title")}
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {runningGamesArray.map(({ game, isLoading, startTime }) => {
                                const elapsed = Date.now() - startTime
                                const progress = Math.min((elapsed / questTimerMs) * 100, 100)
                                return (
                                <DropdownMenuItem
                                    key={game.id}
                                    className="flex items-center gap-3 p-2 cursor-default"
                                    onSelect={(e) => e.preventDefault()}
                                >
                                    <img
                                        src={getGameIconUrl(game, 64)}
                                        alt={game.name}
                                        className="h-8 w-8 rounded-md object-cover bg-muted shrink-0"
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).src = "https://cdn.discordapp.com/embed/avatars/0.png"
                                        }}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{game.name}</p>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs text-green-500 font-medium">{formatElapsedTime(elapsed)}</span>
                                            {settings.questTimerEnabled && (
                                                <span className="text-[10px] text-muted-foreground">/ {formatElapsedTime(questTimerMs)}</span>
                                            )}
                                        </div>
                                        {settings.questTimerEnabled && (
                                            <div className="mt-1 h-1 rounded-full bg-muted/50 overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                                                        progress >= 100 ? "bg-green-500" : "bg-primary"
                                                    }`}
                                                    style={{ width: `${progress}%` }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                        onClick={() => onStopGame?.(game.id)}
                                        disabled={isLoading}
                                    >
                                        {isLoading ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <StopCircle className="h-4 w-4" />
                                        )}
                                    </Button>
                                </DropdownMenuItem>
                                )
                            })}
                            {runningCount > 1 && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="text-destructive focus:text-destructive cursor-pointer"
                                        onClick={() => {
                                            runningGamesArray.forEach(({ game }) => onStopGame?.(game.id))
                                        }}
                                    >
                                        <StopCircle className="h-4 w-4 mr-2" />
                                        {t("taskManager.stopAll")}
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}

                {showUpdateButton && (
                    <TooltipProvider delayDuration={200}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    onClick={handleUpdateButtonClick}
                                    className="h-8 w-8 max-sm:h-7 max-sm:w-7"
                                    disabled={updateState === "checking" || updateState === "downloading"}
                                >
                                    {getUpdateButtonContent()}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                {getUpdateTooltip()}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="secondary"
                            size="icon"
                            aria-label={t("settings.open")}
                            title={t("settings.open")}
                            className="h-8 w-8 max-sm:h-7 max-sm:w-7"
                        >
                            <Settings className="h-5 w-5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72">
                        <DropdownMenuLabel className="flex items-center gap-2 font-medium text-foreground">
                            <Settings className="h-4 w-4" />
                            {t("settings.title")}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="flex items-center gap-2">
                            <Languages className="h-4 w-4" />
                            {t("settings.language")}
                        </DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={currentLanguage} onValueChange={handleLanguageChange}>
                            <DropdownMenuRadioItem value="pt-BR">
                                <span lang="pt-BR">{t("settings.languages.ptBR")}</span>
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="en-US">
                                <span lang="en-US">{t("settings.languages.enUS")}</span>
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="es-ES">
                                <span lang="es-ES">{t("settings.languages.esES")}</span>
                            </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="flex items-center gap-2">
                            <Timer className="h-4 w-4" />
                            {t("settings.questTimer.title")}
                        </DropdownMenuLabel>
                        <DropdownMenuCheckboxItem
                            checked={settings.questTimerEnabled}
                            onCheckedChange={(checked) => setSettings({ questTimerEnabled: checked === true })}
                            onSelect={(e) => e.preventDefault()}
                        >
                            {t("settings.questTimer.show")}
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuRadioGroup
                            value={String(settings.questTimerMinutes)}
                            onValueChange={(value) => setSettings({ questTimerMinutes: Number(value) })}
                        >
                            {QUEST_TIMER_OPTIONS.map((minutes) => (
                                <DropdownMenuRadioItem
                                    key={minutes}
                                    value={String(minutes)}
                                    disabled={!settings.questTimerEnabled}
                                    onSelect={(e) => e.preventDefault()}
                                >
                                    {t("settings.questTimer.minutes", { count: minutes })}
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                        <DropdownMenuCheckboxItem
                            checked={settings.notifyOnTimerEnd}
                            disabled={!settings.questTimerEnabled}
                            onCheckedChange={(checked) => setSettings({ notifyOnTimerEnd: checked === true })}
                            onSelect={(e) => e.preventDefault()}
                        >
                            {t("settings.questTimer.notify")}
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                            checked={settings.stopOnTimerEnd}
                            disabled={!settings.questTimerEnabled}
                            onCheckedChange={(checked) => setSettings({ stopOnTimerEnd: checked === true })}
                            onSelect={(e) => e.preventDefault()}
                        >
                            {t("settings.questTimer.autoStop")}
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="flex items-center gap-2">
                            <AppWindow className="h-4 w-4" />
                            {t("settings.windows.title")}
                        </DropdownMenuLabel>
                        <DropdownMenuCheckboxItem
                            checked={settings.hideGameWindows}
                            onCheckedChange={(checked) => setSettings({ hideGameWindows: checked === true })}
                            onSelect={(e) => e.preventDefault()}
                        >
                            {t("settings.windows.hideGameWindows")}
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                            checked={settings.closeToTray}
                            onCheckedChange={(checked) => setSettings({ closeToTray: checked === true })}
                            onSelect={(e) => e.preventDefault()}
                        >
                            {t("settings.windows.closeToTray")}
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>{t("settings.appearance")}</DropdownMenuLabel>
                        <DropdownMenuItem className="cursor-pointer" onSelect={() => toggleTheme()}>
                            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                            {isDark ? t("theme.toggleLight") : t("theme.toggleDark")}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Minimize - Yellow */}
                <button
                    onClick={handleMinimize}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="group w-5 h-3 rounded-full bg-[#FEBC2E] hover:bg-[#FEBC2E]/80 flex items-center justify-center transition-colors max-sm:w-4"
                >
                    {isHovered && (
                        <Minus className="w-2 h-2 text-[#995700] opacity-0 group-hover:opacity-100 transition-opacity"/>
                    )}
                </button>

                {/* Maximize - Green */}
                <button
                    onClick={handleMaximize}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="group w-5 h-3 rounded-full bg-[#28C840] hover:bg-[#28C840]/80 flex items-center justify-center transition-colors max-sm:w-4"
                >
                    {isHovered && (
                        <Square
                            className="w-1.5 h-1.5 text-[#006500] opacity-0 group-hover:opacity-100 transition-opacity"/>
                    )}
                </button>

                {/* Close - Red */}
                <button
                    onClick={handleClose}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="group w-5 h-3 rounded-full bg-[#FF5F57] hover:bg-[#FF5F57]/80 flex items-center justify-center transition-colors max-sm:w-4"
                >
                    {isHovered &&
                        <X className="w-2 h-2 text-[#4A0002] opacity-0 group-hover:opacity-100 transition-opacity"/>}
                </button>
            </div>
        </header>
    )
}
