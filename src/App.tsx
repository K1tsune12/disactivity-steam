"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import { invoke } from "@tauri-apps/api/core"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { Toaster } from "@/components/ui/sonner"
import { Search, RefreshCw, Gamepad2, Loader2, Star, Filter } from "lucide-react"
import { exit } from "@tauri-apps/plugin-process"
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { getSettings, useSettings } from "@/lib/settings"
import { playSound } from "@/lib/sound"
import { Translated, type TextKey } from "@/components/translated"
import { GameCard, getSteamAppIds, isSteamOnly, type Game } from "@/components/game-card"
import { TitleBar } from "@/components/title-bar"
import { SettingsPanel } from "@/components/settings-panel"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
    PaginationEllipsis,
} from "@/components/ui/pagination"

interface FetchGamesResponse {
    games: Game[]
    from_cache: boolean
}

interface StartGameResponse {
    path: string
    needs_discord_restart: boolean
}

export default function GameLauncher() {
    const { t } = useTranslation()
    const [searchQuery, setSearchQuery] = useState("")
    // Filtering ~20k games on every key press makes typing stutter; wait for a pause
    const [debouncedQuery, setDebouncedQuery] = useState("")
    useEffect(() => {
        const timeout = setTimeout(() => setDebouncedQuery(searchQuery), 150)
        return () => clearTimeout(timeout)
    }, [searchQuery])
    const [steamOnlyFilter, setSteamOnlyFilter] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const settings = useSettings()
    const [games, setGames] = useState<Game[]>([])
    const [filteredGames, setFilteredGames] = useState<Game[]>([])
    const [currentPage, setCurrentPage] = useState(1)
    const [isLoading, setIsLoading] = useState(true)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [runningGames, setRunningGames] = useState<Set<string>>(new Set())
    const [loadingGames, setLoadingGames] = useState<Set<string>>(new Set())
    const [favorites, setFavorites] = useState<Set<string>>(new Set())
    const [gameStartTimes, setGameStartTimes] = useState<Map<string, number>>(new Map())
    const ITEMS_PER_PAGE = 50

    const fetchGames = async (forceRefresh: boolean = false) => {
        try {
            if (forceRefresh) {
                setIsRefreshing(true)
            } else {
                setIsLoading(true)
            }

            const response = await invoke<FetchGamesResponse>("fetch_games", { forceRefresh })
            setGames(response.games)
            setFilteredGames(response.games)
            setCurrentPage(1)

            if (forceRefresh) {
                toast.success(t("toast.refreshed.title"), {
                    description: t("toast.refreshed.description", { count: response.games.length }),
                })
            } else if (response.from_cache) {
                toast.info(t("toast.loadedFromCache.title"), {
                    description: t("toast.loadedFromCache.description", { count: response.games.length }),
                })
            }
        } catch (error) {
            toast.error(t("toast.error.title"), {
                description: t("toast.error.fetchFailed", { error }),
            })
        } finally {
            setIsLoading(false)
            setIsRefreshing(false)
        }
    }

    const fetchFavorites = async () => {
        try {
            const favs = await invoke<string[]>("get_favorites")
            setFavorites(new Set(favs))
        } catch (error) {
            console.error("Failed to load favorites:", error)
        }
    }

    useEffect(() => {
        fetchGames().catch(console.error)
        fetchFavorites().catch(console.error)
    }, [])

    // Discord only rereads the Steam library list on startup
    const showDiscordRestartToast = (description: TextKey) => {
        toast.warning(<Translated text={{ key: "toast.discordRestartNeeded.title" }} />, {
            description: <Translated text={description} />,
            duration: Infinity,
            action: {
                label: <Translated text={{ key: "actions.restartDiscord" }} />,
                onClick: () => {
                    invoke("restart_discord").catch((error) =>
                        toast.error(t("toast.error.title"), { description: `${error}` })
                    )
                },
            },
        })
    }

    // Favorite Steam-only games keep a fake Steam install while the app is open, so one
    // Discord restart is enough for all of them
    const registerSteamFavorites = async (favoriteGames: Game[]) => {
        const steamGames = favoriteGames.filter(isSteamOnly)
        if (steamGames.length === 0) return
        try {
            const needsRestart = await invoke<boolean>("register_steam_favorites", {
                games: steamGames.map((game) => ({
                    id: game.id,
                    name: game.name,
                    steam_app_ids: getSteamAppIds(game),
                })),
            })
            if (needsRestart) {
                showDiscordRestartToast({ key: "toast.discordRestartNeeded.favorites", values: { count: steamGames.length } })
            }
        } catch (error) {
            toast.error(t("toast.error.title"), { description: `${error}` })
        }
    }

    const steamFavoritesRegistered = useRef(false)
    useEffect(() => {
        if (steamFavoritesRegistered.current || games.length === 0 || favorites.size === 0) return
        steamFavoritesRegistered.current = true
        registerSteamFavorites(games.filter((game) => favorites.has(game.id))).catch(console.error)
    }, [games, favorites])

    useEffect(() => {
        const terms = debouncedQuery
            .toLowerCase()
            .split(",")
            .map((term) => term.trim())
            .filter(Boolean)

        setCurrentPage(1)

        const baseGames = steamOnlyFilter ? games.filter(isSteamOnly) : games

        if (terms.length === 0) {
            setFilteredGames(baseGames)
            return
        }

        const results = baseGames.filter((game) => {
            const gameName = game.name.toLowerCase()
            const gameId = game.id.toLowerCase()
            const gameAliases = game.aliases?.map((alias) => alias.toLowerCase()) || []

            return terms.some((term) => {
                if (gameName.includes(term)) return true
                if (gameId.includes(term)) return true
                return gameAliases.some((alias) => alias.includes(term))
            })
        })

        setFilteredGames(results)
    }, [debouncedQuery, games, steamOnlyFilter])

    const handleRefresh = () => {
        setSearchQuery("")
        fetchGames(true).catch(console.error)
    }

    const handleStartGame = async (game: Game, selectedExecutable?: string, useSteam: boolean = false) => {
        const steamAppIds = getSteamAppIds(game)
        if (!useSteam && (!game.executables || game.executables.length === 0)) {
            toast.error(t("toast.cannotStartGame.title"), {
                description: t("toast.cannotStartGame.noExecutables"),
            })
            return
        }

        setLoadingGames((prev) => new Set(prev).add(game.id))

        try {
            const response = await invoke<StartGameResponse>("start_game", {
                gameId: game.id,
                gameName: game.name,
                executables: game.executables || [],
                selectedExecutable: selectedExecutable || null,
                steamAppIds,
                useSteam,
                hideWindow: getSettings().hideGameWindows,
            })

            setRunningGames((prev) => new Set(prev).add(game.id))
            setGameStartTimes((prev) => new Map(prev).set(game.id, Date.now()))
            toast.success(t("toast.gameStarted.title"), {
                description: t("toast.gameStarted.description", { name: game.name }),
            })

            if (response.needs_discord_restart) {
                showDiscordRestartToast({ key: "toast.discordRestartNeeded.description", values: { name: game.name } })
            }
        } catch (error) {
            toast.error(t("toast.failedToStartGame.title"), {
                description: `${error}`,
            })
        } finally {
            setLoadingGames((prev) => {
                const next = new Set(prev)
                next.delete(game.id)
                return next
            })
        }
    }

    const handleStopGame = async (gameId: string) => {
        const game = games.find((g) => g.id === gameId)
        setLoadingGames((prev) => new Set(prev).add(gameId))

        try {
            await invoke("stop_game", { gameId })

            setRunningGames((prev) => {
                const next = new Set(prev)
                next.delete(gameId)
                return next
            })
            setGameStartTimes((prev) => {
                const next = new Map(prev)
                next.delete(gameId)
                return next
            })
            toast.success(t("toast.gameStopped.title"), {
                description: t("toast.gameStopped.description", { name: game?.name || "Game" }),
            })
        } catch (error) {
            toast.error(t("toast.failedToStopGame.title"), {
                description: `${error}`,
            })
        } finally {
            setLoadingGames((prev) => {
                const next = new Set(prev)
                next.delete(gameId)
                return next
            })
        }
    }

    // Windows notification, plus an in-app message and a flashing taskbar icon in case
    // notifications are turned off (Focus assist, or disabled for the app)
    // The title is a game name or a translation key. The in-app message stays open and
    // follows language changes; the Windows notification is sent in the current language.
    const notify = async (title: string | TextKey, body: TextKey) => {
        const titleText = typeof title === "string" ? title : <Translated text={title} />
        toast.info(titleText, { description: <Translated text={body} />, duration: Infinity })
        getCurrentWindow().requestUserAttention(UserAttentionType.Informational).catch(console.error)
        await invoke("show_notification", {
            title: typeof title === "string" ? title : t(title.key, title.values),
            body: t(body.key, body.values),
        })
    }

    // Closing exits the app for real (not to the tray); the backend cleans up on exit
    const closeApp = async (title: string | TextKey, reason: TextKey) => {
        await notify(title, reason).catch(console.error)
        await exit(0)
    }

    // Quest timer end: notify, then stop the game and maybe close the app, once per run
    const timerHandled = useRef<Set<string>>(new Set())
    const handleTimerEnd = async (gameId: string) => {
        const current = getSettings()
        if (current.soundOnTimerEnd) {
            playSound(current.timerSound).catch(console.error)
        }
        const name = games.find((g) => g.id === gameId)?.name || "Game"
        const minutes = current.questTimerMinutes

        if (current.timerEndAction === "none") {
            if (current.notifyOnTimerEnd) {
                await notify(name, { key: "notifications.timerEnd.body", values: { count: minutes } })
            }
            return
        }

        await handleStopGame(gameId)
        const stillRunning = await invoke<string[]>("get_running_games")
        if (current.timerEndAction === "stopAndClose" && stillRunning.length === 0) {
            await closeApp(name, { key: "notifications.appClosed.timerEnd", values: { count: minutes } })
        } else if (current.notifyOnTimerEnd) {
            await notify(name, { key: "notifications.timerEnd.stopped", values: { count: minutes } })
        }
    }

    useEffect(() => {
        if (!settings.questTimerEnabled) return
        const timerMs = settings.questTimerMinutes * 60 * 1000
        const interval = setInterval(() => {
            gameStartTimes.forEach((startTime, gameId) => {
                const key = `${gameId}:${startTime}`
                if (Date.now() - startTime < timerMs || timerHandled.current.has(key)) return
                timerHandled.current.add(key)
                handleTimerEnd(gameId).catch(console.error)
            })
        }, 5000)
        return () => clearInterval(interval)
    }, [settings, gameStartTimes, games])

    // "Close Disactivity after" schedule, independent from the games
    useEffect(() => {
        if (settings.autoCloseAt === null) return
        const closeAt = settings.autoCloseAt
        const interval = setInterval(() => {
            if (Date.now() >= closeAt) {
                clearInterval(interval)
                closeApp(
                    { key: "notifications.appClosed.title" },
                    { key: "notifications.appClosed.scheduled", values: { count: settings.autoCloseMinutes } }
                ).catch(console.error)
            }
        }, 5000)
        return () => clearInterval(interval)
    }, [settings.autoCloseAt, settings.autoCloseMinutes])

    const handleToggleFavorite = async (gameId: string) => {
        try {
            const isFavorite = await invoke<boolean>("toggle_favorite", { gameId })
            setFavorites((prev) => {
                const next = new Set(prev)
                if (isFavorite) {
                    next.add(gameId)
                } else {
                    next.delete(gameId)
                }
                return next
            })
            const game = games.find((g) => g.id === gameId)
            toast.success(isFavorite ? t("toast.addedToFavorites.title") : t("toast.removedFromFavorites.title"), {
                description: game?.name || gameId,
            })

            if (game && isSteamOnly(game)) {
                if (isFavorite) {
                    await registerSteamFavorites([game])
                } else {
                    await invoke("unregister_steam_favorite", { gameId })
                }
            }
        } catch (error) {
            toast.error(t("toast.failedToUpdateFavorites.title"), {
                description: `${error}`,
            })
        }
    }

    // Separate favorites and non-favorites from filtered games
    const { favoriteGames, nonFavoriteGames } = useMemo(() => {
        const favs = filteredGames.filter((game) => favorites.has(game.id))
        const nonFavs = filteredGames.filter((game) => !favorites.has(game.id))
        return { favoriteGames: favs, nonFavoriteGames: nonFavs }
    }, [filteredGames, favorites])

    // Pagination only applies to non-favorite games
    const totalPages = Math.ceil(nonFavoriteGames.length / ITEMS_PER_PAGE)
    const paginatedGames = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
        return nonFavoriteGames.slice(startIndex, startIndex + ITEMS_PER_PAGE)
    }, [nonFavoriteGames, currentPage])

    const goToPage = (page: number) => {
        const validPage = Math.max(1, Math.min(totalPages, page))
        setCurrentPage(validPage)
        // Scroll to top of the game list
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    const getPageNumbers = () => {
        const pages: (number | "ellipsis")[] = []
        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push(i)
        } else {
            pages.push(1)
            if (currentPage > 3) pages.push("ellipsis")
            for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
                pages.push(i)
            }
            if (currentPage < totalPages - 2) pages.push("ellipsis")
            pages.push(totalPages)
        }
        return pages
    }

    // Create a map of running games info for the TitleBar task manager
    const runningGamesInfo = useMemo(() => {
        const map = new Map<string, { game: Game; isLoading: boolean; startTime: number }>()
        runningGames.forEach((gameId) => {
            const game = games.find((g) => g.id === gameId)
            if (game) {
                map.set(gameId, {
                    game,
                    isLoading: loadingGames.has(gameId),
                    startTime: gameStartTimes.get(gameId) || Date.now(),
                })
            }
        })
        return map
    }, [runningGames, loadingGames, games, gameStartTimes])

    return (
        <div className="app-shell h-screen flex flex-col bg-background/90 dark:bg-background/80 font-sans antialiased overflow-hidden">
            <TitleBar
                runningGames={runningGamesInfo}
                onStopGame={handleStopGame}
                onOpenSettings={() => setSettingsOpen((open) => !open)}
            />
            {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

            <ScrollArea className="flex-1 mt-10">
                <main className="mx-5 pb-5 overflow-hidden max-sm:mx-2 max-sm:pb-3">
                    <div className="container mx-auto px-4 py-6 max-w-4xl overflow-hidden max-sm:px-2 max-sm:py-4">

                    {/* Search Bar */}
                    <div className="flex gap-2 mb-6 max-sm:gap-1.5 max-sm:flex-wrap">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="text"
                                placeholder={t("search.placeholder")}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 bg-background max-sm:h-9 max-sm:text-xs"
                                disabled={isLoading}
                            />
                        </div>
                        <TooltipProvider delayDuration={200}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant={steamOnlyFilter ? "default" : "outline"}
                                        size="icon"
                                        onClick={() => setSteamOnlyFilter((value) => !value)}
                                        disabled={isLoading}
                                        aria-pressed={steamOnlyFilter}
                                        aria-label={t("search.steamOnlyFilter")}
                                        className={`shrink-0 max-sm:h-9 max-sm:w-9 ${steamOnlyFilter ? "" : "bg-background"}`}
                                    >
                                        <Filter className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">{t("search.steamOnlyFilter")}</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <Button variant="outline" onClick={handleRefresh} disabled={isLoading || isRefreshing} className="bg-background whitespace-nowrap max-sm:h-9 max-sm:px-2 max-sm:text-xs">
                            {isRefreshing ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <RefreshCw className="h-4 w-4 mr-2" />
                            )}
                            {t("actions.refresh")}
                        </Button>
                    </div>

                    {/* Loading State */}
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20">
                            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                            <p className="text-muted-foreground">{t("loading.games")}</p>
                        </div>
                    ) : (
                        <>
                            {/* Favorites Section */}
                            {favoriteGames.length > 0 && (
                                <div className="mb-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                                        <h2 className="text-sm font-semibold text-foreground">{t("favorites.title")}</h2>
                                        <span className="text-xs text-muted-foreground">({favoriteGames.length})</span>
                                    </div>
                                    <div className="space-y-1">
                                        {favoriteGames.map((game) => (
                                            <GameCard
                                                key={game.id}
                                                game={game}
                                                isRunning={runningGames.has(game.id)}
                                                isLoading={loadingGames.has(game.id)}
                                                isFavorite={true}
                                                startTime={gameStartTimes.get(game.id)}
                                                onStart={handleStartGame}
                                                onStop={handleStopGame}
                                                onToggleFavorite={handleToggleFavorite}
                                            />
                                        ))}
                                    </div>
                                    <Separator className="my-4" />
                                </div>
                            )}

                            {/* Game list */}
                            <div className="space-y-1">
                                {paginatedGames.length > 0 ? (
                                    paginatedGames.map((game) => (
                                        <GameCard
                                            key={game.id}
                                            game={game}
                                            isRunning={runningGames.has(game.id)}
                                            isLoading={loadingGames.has(game.id)}
                                            isFavorite={favorites.has(game.id)}
                                            startTime={gameStartTimes.get(game.id)}
                                            onStart={handleStartGame}
                                            onStop={handleStopGame}
                                            onToggleFavorite={handleToggleFavorite}
                                        />
                                    ))
                                ) : filteredGames.length === 0 ? (
                                    <div className="text-center py-12 text-muted-foreground">
                                        <Gamepad2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                        <p>{t("emptyState.noGamesFound")}</p>
                                    </div>
                                ) : null}
                            </div>

                            {totalPages > 1 && (
                                <div className="mt-6 space-y-4">
                                    <Pagination>
                                        <PaginationContent>
                                            <PaginationItem>
                                                <PaginationPrevious
                                                    href="#"
                                                    onClick={(e) => {
                                                        e.preventDefault()
                                                        goToPage(currentPage - 1)
                                                    }}
                                                    className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                                />
                                            </PaginationItem>
                                            {getPageNumbers().map((page, index) =>
                                                page === "ellipsis" ? (
                                                    <PaginationItem key={`ellipsis-${index}`}>
                                                        <PaginationEllipsis />
                                                    </PaginationItem>
                                                ) : (
                                                    <PaginationItem key={page}>
                                                        <PaginationLink
                                                            href="#"
                                                            onClick={(e) => {
                                                                e.preventDefault()
                                                                goToPage(page)
                                                            }}
                                                            isActive={currentPage === page}
                                                            className="cursor-pointer"
                                                        >
                                                            {page}
                                                        </PaginationLink>
                                                    </PaginationItem>
                                                ),
                                            )}
                                            <PaginationItem>
                                                <PaginationNext
                                                    href="#"
                                                    onClick={(e) => {
                                                        e.preventDefault()
                                                        goToPage(currentPage + 1)
                                                    }}
                                                    className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                                />
                                            </PaginationItem>
                                        </PaginationContent>
                                    </Pagination>

                                    {/* Page Jump */}
                                    <div className="flex items-center justify-center gap-2 text-sm max-sm:flex-wrap max-sm:text-xs">
                                        <span className="text-muted-foreground">{t("pagination.goToPage")}</span>
                                        <Input
                                            type="number"
                                            min={1}
                                            max={totalPages}
                                            className="w-16 h-8 text-center max-sm:h-7 max-sm:w-14 max-sm:text-xs"
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    const value = parseInt((e.target as HTMLInputElement).value)
                                                    if (!isNaN(value)) {
                                                        goToPage(value)
                                                        ;(e.target as HTMLInputElement).value = ""
                                                    }
                                                }
                                            }}
                                        />
                                        <span className="text-muted-foreground">{t("pagination.of")} {totalPages}</span>
                                    </div>
                                </div>
                            )}

                            {/* Footer */}
                            <div className="mt-4 text-center text-sm text-muted-foreground wrap-break-word max-sm:text-xs">
                                {filteredGames.length > 0 ? (
                                    <>
                                        {favoriteGames.length > 0 && (
                                            <span>{favoriteGames.length} {favoriteGames.length !== 1 ? t("footer.favorites") : t("footer.favorite")} • </span>
                                        )}
                                        {t("footer.showing")} {nonFavoriteGames.length > 0 ? ((currentPage - 1) * ITEMS_PER_PAGE) + 1 : 0}-{Math.min(currentPage * ITEMS_PER_PAGE, nonFavoriteGames.length)} {t("pagination.of")} {nonFavoriteGames.length} {nonFavoriteGames.length !== 1 ? t("footer.games") : t("footer.game")}
                                        {totalPages > 1 && ` (${t("footer.page")} ${currentPage} ${t("pagination.of")} ${totalPages})`}
                                    </>
                                ) : (
                                    <>{t("footer.noGames")}</>
                                )}

                                <p>
                                    Copyright © 2026 holasoyender, K1tsune12
                                </p>
                            </div>
                        </>
                    )}
                </div>
            </main>
            </ScrollArea>
            <Toaster />
        </div>
    )
}
