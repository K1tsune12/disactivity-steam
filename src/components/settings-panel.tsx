import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
    AppWindow,
    ArrowLeft,
    FolderOpen,
    Moon,
    Play,
    Plus,
    Power,
    Settings,
    Sun,
    Timer,
    X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    QUEST_TIMER_OPTIONS,
    addCustomTimerOption,
    parseMinutes,
    removeCustomTimerOption,
    setSettings,
    useSettings,
    type TimerEndAction,
} from "@/lib/settings"
import { SOUND_PRESETS, findSoundPreset, pickSoundFile, playSound, soundFileName } from "@/lib/sound"
import { setTheme, setTranslucency, useTheme, useTranslucency, type Translucency } from "@/lib/theme"
import { cn } from "@/lib/utils"

type SupportedLanguage = "pt-BR" | "en-US" | "es-ES"

function getSupportedLanguage(language: string): SupportedLanguage {
    const baseLanguage = language.toLowerCase().split("-")[0]
    if (baseLanguage === "pt") return "pt-BR"
    if (baseLanguage === "es") return "es-ES"
    return "en-US"
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
    return (
        <section className="rounded-lg border border-border/50 bg-card/50 p-4 space-y-3">
            <div>
                <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
            </div>
            {children}
        </section>
    )
}

interface SwitchRowProps {
    label: string
    description?: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    disabled?: boolean
}

function SwitchRow({ label, description, checked, onCheckedChange, disabled }: SwitchRowProps) {
    const id = React.useId()
    return (
        <div className={cn("flex items-center justify-between gap-4", disabled && "opacity-50")}>
            <label htmlFor={id} className="min-w-0 cursor-pointer">
                <span className="block text-sm text-foreground">{label}</span>
                {description && <span className="block text-xs text-muted-foreground">{description}</span>}
            </label>
            <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
        </div>
    )
}

interface Choice<T extends string> {
    value: T
    label: React.ReactNode
    onRemove?: () => void
    removeLabel?: string
}

interface ChoiceGroupProps<T extends string> {
    value: T
    choices: Choice<T>[]
    onChange: (value: T) => void
    disabled?: boolean
}

/** Buttons side by side that wrap to new lines on narrow windows */
function ChoiceGroup<T extends string>({ value, choices, onChange, disabled }: ChoiceGroupProps<T>) {
    return (
        <div className="flex flex-wrap gap-2" role="radiogroup">
            {choices.map((choice) => {
                const selected = choice.value === value
                return (
                    <div key={choice.value} className="flex">
                        <Button
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            size="sm"
                            variant={selected ? "default" : "outline"}
                            disabled={disabled}
                            onClick={() => onChange(choice.value)}
                            className={cn("gap-1.5", !selected && "bg-background", choice.onRemove && "rounded-r-none")}
                        >
                            {choice.label}
                        </Button>
                        {choice.onRemove && (
                            <Button
                                type="button"
                                size="sm"
                                variant={selected ? "default" : "outline"}
                                disabled={disabled}
                                aria-label={choice.removeLabel}
                                title={choice.removeLabel}
                                onClick={choice.onRemove}
                                className={cn("rounded-l-none border-l-0 px-2", !selected && "bg-background")}
                            >
                                <X className="h-3.5 w-3.5" />
                            </Button>
                        )}
                    </div>
                )
            })}
        </div>
    )
}

interface MinutesFieldProps {
    value: string
    onChange: (value: string) => void
    onSubmit: (minutes: number) => void
    placeholder: string
    buttonLabel: string
    buttonIcon: React.ReactNode
    disabled?: boolean
}

function MinutesField({ value, onChange, onSubmit, placeholder, buttonLabel, buttonIcon, disabled }: MinutesFieldProps) {
    const minutes = parseMinutes(value)
    const submit = () => {
        if (minutes !== null) onSubmit(minutes)
    }
    return (
        <div className="flex max-w-xs items-center gap-2">
            <Input
                type="number"
                min={1}
                inputMode="numeric"
                value={value}
                placeholder={placeholder}
                disabled={disabled}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") submit()
                }}
                className="h-9 bg-background"
            />
            <Button type="button" variant="secondary" className="shrink-0 gap-1.5" disabled={disabled || minutes === null} onClick={submit}>
                {buttonIcon}
                {buttonLabel}
            </Button>
        </div>
    )
}

interface SettingsPanelProps {
    onClose: () => void
}

/** Full window settings, below the title bar, organized in tabs */
export function SettingsPanel({ onClose }: SettingsPanelProps) {
    const { t, i18n } = useTranslation()
    const settings = useSettings()
    const theme = useTheme()
    const translucency = useTranslucency()
    const currentLanguage = getSupportedLanguage(i18n.resolvedLanguage || i18n.language)
    const [customMinutesInput, setCustomMinutesInput] = useState("")
    const [autoCloseInput, setAutoCloseInput] = useState(String(settings.autoCloseMinutes))
    const timerOff = !settings.questTimerEnabled

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose()
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [onClose])

    // Only an explicit choice is saved; otherwise the system language is used
    const changeLanguage = (language: string) => {
        i18n.services.languageDetector?.cacheUserLanguage?.(language, ["localStorage"])
        i18n.changeLanguage(language).catch(console.error)
    }

    const soundName = (sound: string) => {
        const preset = findSoundPreset(sound)
        return preset ? t(`settings.sound.presets.${preset.id}`) : soundFileName(sound)
    }

    const previewSound = (sound: string) => {
        playSound(sound).catch((error) => toast.error(t("settings.sound.error"), { description: `${error}` }))
    }

    const selectSound = (sound: string) => {
        setSettings({ timerSound: sound })
        previewSound(sound)
    }

    const chooseSoundFile = async () => {
        const file = await pickSoundFile()
        if (file) selectSound(file)
    }

    const addCustomTimer = (minutes: number) => {
        addCustomTimerOption(minutes)
        setCustomMinutesInput("")
    }

    // The deadline lives only in memory: reopening the app never closes it by surprise
    const scheduleAutoClose = (enabled: boolean, minutes: number) => {
        setAutoCloseInput(String(minutes))
        setSettings({
            autoCloseMinutes: minutes,
            autoCloseAt: enabled ? Date.now() + minutes * 60 * 1000 : null,
        })
    }

    const soundChoices = SOUND_PRESETS.map((preset) => ({
        value: preset.file as string,
        label: t(`settings.sound.presets.${preset.id}`),
    }))
    if (!findSoundPreset(settings.timerSound)) {
        soundChoices.push({ value: settings.timerSound, label: soundFileName(settings.timerSound) })
    }

    return (
        <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex flex-col bg-background">
            <div className="flex items-center gap-2 px-4 pt-3 pb-2 max-sm:px-3">
                <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("settings.back")} title={t("settings.back")}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <h2 className="text-lg font-semibold text-foreground">{t("settings.title")}</h2>
            </div>

            <Tabs defaultValue="general" className="min-h-0 flex-1">
                <div className="px-4 max-sm:px-3">
                    <TabsList className="mx-auto max-w-2xl">
                        <TabsTrigger value="general">
                            <Settings />
                            {t("settings.tabs.general")}
                        </TabsTrigger>
                        <TabsTrigger value="timer">
                            <Timer />
                            {t("settings.tabs.timer")}
                        </TabsTrigger>
                        <TabsTrigger value="windows">
                            <AppWindow />
                            {t("settings.tabs.windows")}
                        </TabsTrigger>
                        <TabsTrigger value="autoClose">
                            <Power />
                            {t("settings.tabs.autoClose")}
                        </TabsTrigger>
                    </TabsList>
                </div>

                <ScrollArea className="min-h-0 flex-1">
                    <div className="mx-auto max-w-2xl px-4 pb-6 max-sm:px-3">
                        <TabsContent value="general" className="space-y-3">
                            <Section title={t("settings.language")}>
                                <ChoiceGroup
                                    value={currentLanguage}
                                    onChange={changeLanguage}
                                    choices={[
                                        { value: "pt-BR", label: t("settings.languages.ptBR") },
                                        { value: "en-US", label: t("settings.languages.enUS") },
                                        { value: "es-ES", label: t("settings.languages.esES") },
                                    ]}
                                />
                            </Section>
                            <Section title={t("settings.appearance")}>
                                <ChoiceGroup
                                    value={theme}
                                    onChange={setTheme}
                                    choices={[
                                        { value: "light", label: <><Sun className="h-4 w-4" />{t("theme.light")}</> },
                                        { value: "dark", label: <><Moon className="h-4 w-4" />{t("theme.dark")}</> },
                                    ]}
                                />
                            </Section>
                            <Section title={t("settings.translucency.title")} description={t("settings.translucency.hint")}>
                                <ChoiceGroup
                                    value={translucency}
                                    onChange={(value) => setTranslucency(value as Translucency)}
                                    choices={(["off", "mica", "acrylic"] as const).map((value) => ({
                                        value,
                                        label: t(`settings.translucency.${value}`),
                                    }))}
                                />
                            </Section>
                        </TabsContent>

                        <TabsContent value="timer" className="space-y-3">
                            <Section title={t("settings.questTimer.title")}>
                                <SwitchRow
                                    label={t("settings.questTimer.show")}
                                    checked={settings.questTimerEnabled}
                                    onCheckedChange={(checked) => setSettings({ questTimerEnabled: checked })}
                                />
                            </Section>

                            <Section title={t("settings.questTimer.duration")} description={t("settings.questTimer.durationHint")}>
                                <ChoiceGroup
                                    value={String(settings.questTimerMinutes)}
                                    onChange={(value) => setSettings({ questTimerMinutes: Number(value) })}
                                    disabled={timerOff}
                                    choices={[...QUEST_TIMER_OPTIONS, ...settings.customTimerOptions].map((minutes) => ({
                                        value: String(minutes),
                                        label: t("settings.questTimer.minutes", { count: minutes }),
                                        ...(!QUEST_TIMER_OPTIONS.includes(minutes) && {
                                            onRemove: () => removeCustomTimerOption(minutes),
                                            removeLabel: t("settings.questTimer.remove"),
                                        }),
                                    }))}
                                />
                                <MinutesField
                                    value={customMinutesInput}
                                    onChange={setCustomMinutesInput}
                                    onSubmit={addCustomTimer}
                                    disabled={timerOff}
                                    placeholder={t("settings.questTimer.customPlaceholder")}
                                    buttonLabel={t("settings.questTimer.add")}
                                    buttonIcon={<Plus className="h-4 w-4" />}
                                />
                            </Section>

                            <Section title={t("settings.questTimer.whenEnds")}>
                                <ChoiceGroup
                                    value={settings.timerEndAction}
                                    onChange={(value) => setSettings({ timerEndAction: value as TimerEndAction })}
                                    disabled={timerOff}
                                    choices={(["none", "stop", "stopAndClose"] as const).map((action) => ({
                                        value: action,
                                        label: t(`settings.questTimer.actions.${action}`),
                                    }))}
                                />
                                <SwitchRow
                                    label={t("settings.questTimer.notify")}
                                    checked={settings.notifyOnTimerEnd}
                                    disabled={timerOff}
                                    onCheckedChange={(checked) => setSettings({ notifyOnTimerEnd: checked })}
                                />
                                <SwitchRow
                                    label={t("settings.questTimer.sound")}
                                    checked={settings.soundOnTimerEnd}
                                    disabled={timerOff}
                                    onCheckedChange={(checked) => setSettings({ soundOnTimerEnd: checked })}
                                />
                            </Section>

                            <Section
                                title={t("settings.sound.current", { name: soundName(settings.timerSound) })}
                                description={t("settings.sound.hint")}
                            >
                                <ChoiceGroup
                                    value={settings.timerSound}
                                    onChange={selectSound}
                                    disabled={timerOff || !settings.soundOnTimerEnd}
                                    choices={soundChoices}
                                />
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        className="gap-1.5"
                                        disabled={timerOff || !settings.soundOnTimerEnd}
                                        onClick={() => chooseSoundFile().catch(console.error)}
                                    >
                                        <FolderOpen className="h-4 w-4" />
                                        {t("settings.sound.chooseFile")}
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        className="gap-1.5"
                                        disabled={timerOff || !settings.soundOnTimerEnd}
                                        onClick={() => previewSound(settings.timerSound)}
                                    >
                                        <Play className="h-4 w-4" />
                                        {t("settings.sound.preview")}
                                    </Button>
                                </div>
                            </Section>
                        </TabsContent>

                        <TabsContent value="windows" className="space-y-3">
                            <Section title={t("settings.windows.title")}>
                                <SwitchRow
                                    label={t("settings.windows.hideGameWindows")}
                                    description={t("settings.windows.hideGameWindowsHint")}
                                    checked={settings.hideGameWindows}
                                    onCheckedChange={(checked) => setSettings({ hideGameWindows: checked })}
                                />
                                <SwitchRow
                                    label={t("settings.windows.closeToTray")}
                                    description={t("settings.windows.closeToTrayHint")}
                                    checked={settings.closeToTray}
                                    onCheckedChange={(checked) => setSettings({ closeToTray: checked })}
                                />
                            </Section>
                        </TabsContent>

                        <TabsContent value="autoClose" className="space-y-3">
                            <Section title={t("settings.autoClose.title")} description={t("settings.autoClose.hint")}>
                                <SwitchRow
                                    label={
                                        settings.autoCloseAt !== null
                                            ? t("settings.autoClose.at", {
                                                time: new Date(settings.autoCloseAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                                            })
                                            : t("settings.autoClose.enable", { count: settings.autoCloseMinutes })
                                    }
                                    checked={settings.autoCloseAt !== null}
                                    onCheckedChange={(checked) => scheduleAutoClose(checked, settings.autoCloseMinutes)}
                                />
                                <MinutesField
                                    value={autoCloseInput}
                                    onChange={setAutoCloseInput}
                                    onSubmit={(minutes) => scheduleAutoClose(true, minutes)}
                                    placeholder={t("settings.autoClose.placeholder")}
                                    buttonLabel={t("settings.autoClose.start")}
                                    buttonIcon={<Power className="h-4 w-4" />}
                                />
                            </Section>
                        </TabsContent>
                    </div>
                </ScrollArea>
            </Tabs>
        </div>
    )
}
