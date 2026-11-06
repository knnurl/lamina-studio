// Theme toggle. Dark is the default; the choice is a per-viewer convenience kept in localStorage,
// which can be missing or throw (private windows, blocked storage), so every access is guarded.

const kThemeKey = 'lamina-theme';

function read_saved_theme() {
    try {
        return localStorage.getItem(kThemeKey);
    } catch {
        return null;
    }
}

function save_theme(theme) {
    try {
        localStorage.setItem(kThemeKey, theme);
    } catch {
        // Storage unavailable: the theme still applies for this session.
    }
}

function apply_theme(theme, button) {
    document.documentElement.dataset.theme = theme;
    const next = theme === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', `Switch to ${next} theme`);
    button.title = `Switch to ${next} theme`;
}

export function init_theme(button) {
    apply_theme(read_saved_theme() === 'light' ? 'light' : 'dark', button);
    button.addEventListener('click', () => {
        const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        apply_theme(theme, button);
        save_theme(theme);
    });
}
