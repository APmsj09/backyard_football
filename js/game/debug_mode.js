// js/game/debug_mode.js

const STORAGE_KEY = 'backyardFootballDebugMode';

let debugModeEnabled = false;

try {
    debugModeEnabled = localStorage.getItem(STORAGE_KEY) === 'true';
} catch {
    // Storage may be unavailable; default to Debug OFF.
}

export function isDebugMode() {
    return debugModeEnabled;
}

export function setDebugMode(enabled) {
    debugModeEnabled = Boolean(enabled);

    try {
        localStorage.setItem(STORAGE_KEY, String(debugModeEnabled));
    } catch {
        // The toggle still works for this session without storage.
    }

    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('backyard-debug-mode-changed', {
                detail: { enabled: debugModeEnabled }
            })
        );
    }

    return debugModeEnabled;
}

export function debugLog(...args) {
    if (!debugModeEnabled) return;
    console.debug('[BFGM DEBUG]', ...args);
}

export function debugWarn(...args) {
    if (!debugModeEnabled) return;
    console.warn('[BFGM DEBUG]', ...args);
}
