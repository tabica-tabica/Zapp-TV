// TV Navigation Hook - Handles D-pad navigation for Smart TVs

import { useEffect, useCallback } from 'react';
import { naTV } from '../services/platformApp';

// Key codes for TV remotes
export const TV_KEYS = {
    // Arrow keys
    UP: ['ArrowUp', '38'],
    DOWN: ['ArrowDown', '40'],
    LEFT: ['ArrowLeft', '37'],
    RIGHT: ['ArrowRight', '39'],

    // Action keys - Samsung OK button uses 13, 29443, or space (32)
    ENTER: ['Enter', '13', '29443', ' ', '32', 'Select'],
    // Botão físico "Voltar" do controle remoto + 'Escape' (padrão de
    // desktop, funciona em QUALQUER lugar, dentro ou fora de campo de
    // texto). Backspace/tecla 8 NUNCA entram aqui: um teclado de verdade
    // (desktop, ou bluetooth numa TV) usa essas teclas pra apagar
    // caractere, não pra fechar campo/voltar de tela — ver LEGACY_REMOTE_BACK.
    BACK: ['XF86Back', '10009', '461', 'Escape'],

    // Media keys
    PLAY: ['MediaPlayPause', '415'],
    PAUSE: ['MediaPause', '19'],
    STOP: ['MediaStop', '413'],

    // Color keys (Samsung/LG) — '1'..'4' são o fallback de teclado (sem
    // equivalente físico num teclado comum pras cores do controle).
    RED: ['ColorF0Red', '403', '1'],
    GREEN: ['ColorF1Green', '404', '2'],
    YELLOW: ['ColorF2Yellow', '405', '3'],
    BLUE: ['ColorF3Blue', '406', '4'],
};

// Alguns controles remotos antigos mandam o código de Backspace pro botão
// físico "Voltar". Só conta FORA de um campo de texto (dentro, precisa
// continuar apagando caractere) e só em build de TV — fora disso, em
// desktop, era só uma armadilha: Backspace solto fechava tela/campo sem
// querer no meio de uma digitação normal.
const LEGACY_REMOTE_BACK = ['Backspace', '8'];

type Direction = 'up' | 'down' | 'left' | 'right';
type TVAction = 'enter' | 'back' | 'play' | 'pause' | 'stop' | 'red' | 'green' | 'yellow' | 'blue';
type TizenHardwareKeyEvent = Event & { keyName?: string };

interface UseTVNavigationOptions {
    onNavigate?: (direction: Direction) => void;
    onAction?: (action: TVAction) => void;
    onBack?: () => void;
    /**
     * @param fromInput true quando o OK veio de DENTRO de um campo de texto —
     * nesse caso o hook já fechou o teclado nativo, e reabrir a busca aqui
     * refocaria o input, deixando o IME do Tizen piscando num loop sem saída.
     */
    onEnter?: (fromInput?: boolean) => void;
    enabled?: boolean;
}

// Confere `key` E `keyCode`: o webOS manda Voltar como key "RCUBack" com
// keyCode 461 — olhando só o key, o Voltar do controle LG não fazia nada
export const matchKey = (event: { key?: string; keyCode?: number }, codes: string[]): boolean =>
    (!!event.key && codes.includes(event.key)) || (!!event.keyCode && codes.includes(String(event.keyCode)));

export function useTVNavigation(options: UseTVNavigationOptions = {}) {
    const { onNavigate, onAction, onBack, onEnter, enabled = true } = options;

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        if (!enabled) return;

        // Ignore events if user is currently focused on an input/textarea
        // This allows the native TV keyboard (IME) to handle Backspace, Left, Right, etc.
        const target = event.target as HTMLElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
            // Dentro de input, espaço (32) é TEXTO — só Enter/OK de verdade
            // fecha o teclado (buscar "ESPN 2" precisa do espaço)
            if (matchKey(event, ['Enter', '13', '29443', 'Select'])) {
                event.preventDefault();
                event.stopPropagation();
                target.blur();
                onEnter?.(true);
                onAction?.('enter');
                return;
            }

            // If the user presses the 'Return' / 'Back' button on the TV remote while editing,
            // we should blur the input to hide the virtual keyboard and restore TV navigation.
            // 10009 (Tizen Back), 461 (WebOS Back), XF86Back (Generic), Escape.
            // Backspace/tecla 8 propositalmente NÃO entram aqui — ver LEGACY_REMOTE_BACK.
            if (matchKey(event, TV_KEYS.BACK)) {
                event.preventDefault();
                event.stopPropagation();
                target.blur();
                onBack?.();
                onAction?.('back');
            }
            return;
        }

        // Navigation
        if (matchKey(event, TV_KEYS.UP)) {
            if (onNavigate) { event.preventDefault(); onNavigate('up'); }
        } else if (matchKey(event, TV_KEYS.DOWN)) {
            if (onNavigate) { event.preventDefault(); onNavigate('down'); }
        } else if (matchKey(event, TV_KEYS.LEFT)) {
            if (onNavigate) { event.preventDefault(); onNavigate('left'); }
        } else if (matchKey(event, TV_KEYS.RIGHT)) {
            if (onNavigate) { event.preventDefault(); onNavigate('right'); }
        }
        // Actions
        else if (matchKey(event, TV_KEYS.ENTER)) {
            if (onEnter || onAction) {
                event.preventDefault();
                onEnter?.();
                onAction?.('enter');
            }
        } else if (matchKey(event, TV_KEYS.BACK) || (naTV() && matchKey(event, LEGACY_REMOTE_BACK))) {
            if (onBack || onAction) {
                event.preventDefault();
                onBack?.();
                onAction?.('back');
            }
        }
        // Media
        else if (matchKey(event, TV_KEYS.PLAY)) {
            if (onAction) { event.preventDefault(); onAction('play'); }
        } else if (matchKey(event, TV_KEYS.PAUSE)) {
            if (onAction) { event.preventDefault(); onAction('pause'); }
        } else if (matchKey(event, TV_KEYS.STOP)) {
            if (onAction) { event.preventDefault(); onAction('stop'); }
        }
        // Color keys (atalhos por página)
        else if (matchKey(event, TV_KEYS.RED)) {
            if (onAction) { event.preventDefault(); onAction('red'); }
        } else if (matchKey(event, TV_KEYS.GREEN)) {
            if (onAction) { event.preventDefault(); onAction('green'); }
        } else if (matchKey(event, TV_KEYS.YELLOW)) {
            if (onAction) { event.preventDefault(); onAction('yellow'); }
        } else if (matchKey(event, TV_KEYS.BLUE)) {
            if (onAction) { event.preventDefault(); onAction('blue'); }
        }
    }, [enabled, onNavigate, onAction, onBack, onEnter]);

    useEffect(() => {
        // Custom handler for Tizen hardware 'back' key when keyboard is open
        const handleTizenHwKey = (e: TizenHardwareKeyEvent) => {
            if (e.keyName === 'back' || e.keyName === 'Return') {
                const active = document.activeElement as HTMLElement;
                if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                    active.blur();
                    // Let TV close the keyboard
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('tizenhwkey', handleTizenHwKey as EventListener);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('tizenhwkey', handleTizenHwKey as EventListener);
        };
    }, [handleKeyDown]);
}
