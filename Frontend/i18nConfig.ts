import en from './messages/en';

type MessageTree = Record<string, unknown>;

const messages: Record<string, MessageTree> = {
    en,
};

let currentLocale = 'en';

function resolveLocale(language?: string): string {
    if (!language) {
        return 'en';
    }
    const lower = language.toLowerCase();
    if (messages[lower]) {
        return lower;
    }
    let locale = lower;
    while (locale) {
        if (messages[locale]) {
            return locale;
        }
        const index = locale.lastIndexOf('-');
        if (index > 0) {
            locale = locale.substring(0, index);
        } else {
            break;
        }
    }
    return 'en';
}

function lookup(tree: MessageTree, key: string): string | undefined {
    const parts = key.split('.');
    let current: unknown = tree;
    for (const part of parts) {
        if (current == null || typeof current !== 'object') {
            return undefined;
        }
        current = (current as MessageTree)[part];
    }
    return typeof current === 'string' ? current : undefined;
}

export function initI18n(language?: string): void {
    currentLocale = resolveLocale(language);
}

export function $t(key: string, vars?: Record<string, string | number>): string {
    let message = lookup(messages[currentLocale], key)
        ?? lookup(messages.en, key)
        ?? key;
    if (vars) {
        for (const [name, value] of Object.entries(vars)) {
            message = message.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
        }
    }
    return message;
}
