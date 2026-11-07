// Assistant settings (SPEC M4.5): the user's own keys, the model and the effort. Keys stay in this
// browser: in localStorage when the user asks to remember them, otherwise only for this session.
const kKey = 'lamina-ai';

function read(storage) {
    try {
        return JSON.parse(storage.getItem(kKey) ?? 'null');
    } catch {
        return null;
    }
}

export function load_settings() {
    const saved = read(window.localStorage) ?? read(window.sessionStorage) ?? {};
    return {
        claude_key: saved.claude_key ?? '',
        gemini_key: saved.gemini_key ?? '',
        model: saved.model ?? 'claude-opus-5-5',
        effort: saved.effort ?? 'high',
        remember: saved.remember ?? false,
    };
}

export function save_settings(s) {
    try {
        const text = JSON.stringify(s);
        window.localStorage.removeItem(kKey);
        window.sessionStorage.removeItem(kKey);
        (s.remember ? window.localStorage : window.sessionStorage).setItem(kKey, text);
    } catch {
        // Storage blocked: the settings last until the page closes.
    }
}

export function forget_keys(s) {
    const cleared = { ...s, claude_key: '', gemini_key: '' };
    save_settings(cleared);
    return cleared;
}
