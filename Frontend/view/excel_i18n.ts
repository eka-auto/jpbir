import { getConfigs } from '../../util/vscodeConfig.ts';
import Spreadsheet from './x-spreadsheet/index';
import en from './x-spreadsheet/locale/en';
import { t as localeT } from './x-spreadsheet/locale/locale';

const localeMessages: Record<string, object> = {
    en,
};

let currentLang = 'en';
let initialized = false;

export function initExcelLocale(): string {
    if (initialized) return currentLang;
    const lang = 'en';
    const messages = localeMessages[lang] ?? en;
    Spreadsheet.locale(lang, messages);
    currentLang = lang;
    initialized = true;
    return lang;
}

export function getExcelLang(): string {
    if (!initialized) initExcelLocale();
    return currentLang;
}

/** Translate a locale key; `{}` placeholders are filled in order. */
export function t(key: string, ...args: (string | number)[]): string {
    if (!initialized) initExcelLocale();
    let text = localeT(key);
    for (const arg of args) {
        text = text.replace('{}', String(arg));
    }
    return text;
}
