"use client"

import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Info, Play, Square, Loader2, Star, ChevronDown, Gamepad2 } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useSettings } from "@/lib/settings"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export interface Executable {
    name: string
    os?: string
    is_launcher?: boolean
}

export interface ThirdPartySku {
    distributor: string
    id?: string | null
}

export interface Game {
    id: string
    name: string
    icon_hash: string
    executables?: Executable[] | null
    aliases?: string[] | null
    third_party_skus?: ThirdPartySku[] | null
}

export function getSteamAppIds(game: Game): string[] {
    return (game.third_party_skus || [])
        .filter((sku) => sku.distributor === "steam" && sku.id)
        .map((sku) => sku.id as string)
}

function getWin32Executables(game: Game): Executable[] {
    return (game.executables || []).filter(
        (exe) => exe.os === "win32" && !exe.name.startsWith(">")
    )
}

/** Without registered executables the only way to run is Steam library mode */
export function isSteamOnly(game: Game): boolean {
    return getWin32Executables(game).length === 0 && getSteamAppIds(game).length > 0
}

interface GameCardProps {
    game: Game
    isRunning: boolean
    isLoading: boolean
    isFavorite: boolean
    startTime?: number
    onStart: (game: Game, selectedExecutable?: string, useSteam?: boolean) => void
    onStop: (gameId: string) => void
    onToggleFavorite: (gameId: string) => void
}

function getGameIconUrl(game: Game, size: number = 64): string {
    if (game.icon_hash) {
        return `https://cdn.discordapp.com/app-icons/${game.id}/${game.icon_hash}.png?size=${size}&keep_aspect_ratio=false`
    }
    return "https://cdn.discordapp.com/embed/avatars/0.png"
}

function formatElapsedTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    const pad = (n: number) => n.toString().padStart(2, "0")
    if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    return `${pad(minutes)}:${pad(seconds)}`
}

export function GameCard({ game, isRunning, isLoading, isFavorite, startTime, onStart, onStop, onToggleFavorite }: GameCardProps) {
    const { t } = useTranslation()
    const [elapsed, setElapsed] = useState(0)

    useEffect(() => {
        if (!isRunning || !startTime) {
            setElapsed(0)
            return
        }
        setElapsed(Date.now() - startTime)
        const interval = setInterval(() => {
            setElapsed(Date.now() - startTime)
        }, 1000)
        return () => clearInterval(interval)
    }, [isRunning, startTime])

    const settings = useSettings()
    const questTimerMs = settings.questTimerMinutes * 60 * 1000
    const progress = Math.min((elapsed / questTimerMs) * 100, 100)

    const win32Executables = getWin32Executables(game)
    const hasSteam = getSteamAppIds(game).length > 0
    const steamOnly = isSteamOnly(game)
    const hasRunOptions = win32Executables.length > 1 || (win32Executables.length > 0 && hasSteam)

    const handleClick = () => {
        if (isRunning) {
            onStop(game.id)
        } else {
            onStart(game, undefined, steamOnly)
        }
    }

    return (
        // content-visibility skips layout and paint of cards outside the scroll view.
        // No backdrop blur on purpose: behind a card there is only the flat app background,
        // so it drew the same pixels at the cost of a GPU pass per card on every scroll frame.
        <div className={`flex items-center gap-4 p-3 rounded-lg border transition-colors overflow-hidden [content-visibility:auto] [contain-intrinsic-size:auto_80px] max-sm:gap-2 max-sm:p-2 ${
            isRunning 
                ? "border-green-500/50 bg-green-500/10 hover:bg-green-500/15" 
                : isFavorite
                    ? "border-yellow-500/50 bg-yellow-500/17 hover:bg-yellow-500/25"
                    : "border-border/50 bg-card/50 hover:bg-accent/30"
        }`}>
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted/50 max-sm:h-11 max-sm:w-11">
                <img
                    src={getGameIconUrl(game, 128)}
                    alt={game.name}
                    className="object-cover w-full h-full"
                    onError={(e) => {
                        (e.target as HTMLImageElement).src = "/placeholder.svg"
                    }}
                />
                {isRunning && (
                    <div className="absolute inset-0 flex items-center justify-center bg-green-500/20">
                        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                    </div>
                )}
            </div>

            <div className="flex-1 min-w-0 overflow-hidden">
                <div className="flex items-center gap-2 min-w-0">
                    <h3 className="font-medium text-foreground truncate min-w-0 max-sm:text-sm">{game.name}</h3>
                    {steamOnly && (
                        <TooltipProvider delayDuration={200}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-500 font-medium whitespace-nowrap shrink-0 cursor-help max-sm:text-[10px] max-sm:px-1">
                                        Steam
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs">
                                    {t("gameCard.steamOnly")}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                    {isRunning && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-500 font-medium whitespace-nowrap shrink-0 max-sm:text-[10px] max-sm:px-1">
                            {formatElapsedTime(elapsed)}
                        </span>
                    )}
                    <TooltipProvider delayDuration={200}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Info className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-help shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                                <div className="space-y-1">
                                    <p className="font-semibold">{game.name}</p>
                                    <p className="text-xs text-muted-foreground">{t("gameCard.id")}: {game.id}</p>
                                    {game.executables && game.executables.length > 0 && (
                                        <div className="text-xs">
                                            <p className="font-medium">{t("gameCard.executables")}:</p>
                                            <ul className="list-disc list-inside max-h-32 overflow-y-auto">
                                                {game.executables.map((exe, idx) => (
                                                    <li key={idx} className="text-muted-foreground truncate">
                                                        {exe.name} {exe.os && <span className="opacity-70">({exe.os})</span>}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <span className="block truncate max-w-full text-xs text-muted-foreground font-mono max-sm:text-[10px]">{t("gameCard.id")}: {game.id}</span>
                {isRunning && settings.questTimerEnabled && (
                    <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                                    progress >= 100 ? "bg-green-500" : "bg-primary"
                                }`}
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 max-sm:hidden">
                            {formatElapsedTime(elapsed)} / {formatElapsedTime(questTimerMs)}
                        </span>
                    </div>
                )}
            </div>

            <TooltipProvider delayDuration={200}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="shrink-0 h-8 w-8 max-sm:h-7 max-sm:w-7"
                            onClick={() => onToggleFavorite(game.id)}
                        >
                            <Star
                                className={`h-4 w-4 transition-colors ${
                                    isFavorite 
                                        ? "fill-yellow-500 text-yellow-500" 
                                        : "text-muted-foreground hover:text-yellow-500"
                                }`}
                            />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                        {isFavorite ? t("favorites.remove") : t("favorites.add")}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>

            <div className="flex shrink-0">
                <Button
                    size="sm"
                    onClick={handleClick}
                    className={`shrink-0 max-sm:h-8 max-sm:px-2 ${!isRunning && hasRunOptions ? "rounded-r-none" : ""}`}
                    variant={isRunning ? "destructive" : "default"}
                    disabled={isLoading}
                >
                    {isLoading ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : isRunning ? (
                        <Square className="h-4 w-4 mr-1.5" />
                    ) : (
                        <Play className="h-4 w-4 mr-1.5" />
                    )}
                    <span className="max-[420px]:hidden">{isRunning ? t("actions.stop") : t("actions.run")}</span>
                </Button>
                {!isRunning && hasRunOptions && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                size="sm"
                                variant="default"
                                className="rounded-l-none border-l border-l-primary-foreground/20 px-1.5 max-sm:h-8"
                                disabled={isLoading}
                            >
                                <ChevronDown className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="max-h-60 overflow-y-auto">
                            {win32Executables.map((exe, idx) => (
                                <DropdownMenuItem
                                    key={idx}
                                    onClick={() => onStart(game, exe.name)}
                                    className="text-xs font-mono cursor-pointer"
                                >
                                    {exe.name}
                                </DropdownMenuItem>
                            ))}
                            {hasSteam && (
                                <DropdownMenuItem
                                    onClick={() => onStart(game, undefined, true)}
                                    className="text-xs cursor-pointer"
                                >
                                    <Gamepad2 className="h-4 w-4 mr-1.5" />
                                    {t("gameCard.runViaSteam")}
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        </div>
    )
}
