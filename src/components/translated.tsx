import { useTranslation } from "react-i18next"

/** A translation key with its values, resolved only when shown */
export interface TextKey {
    key: string
    values?: Record<string, unknown>
}

/** Text that follows language changes while it is on screen (persistent toasts keep
 *  their content, so a string translated when they opened would stay in the old language) */
export function Translated({ text }: { text: TextKey }) {
    const { t } = useTranslation()
    return <>{t(text.key, text.values)}</>
}
