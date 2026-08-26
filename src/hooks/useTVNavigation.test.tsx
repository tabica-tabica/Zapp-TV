// @vitest-environment jsdom
//
// O único teste do projeto que precisa de DOM — e precisa mesmo: este hook é a
// TRADUÇÃO de todo controle remoto que o app entende, e ele registra o listener
// no `window`, olha o `event.target` e chama `preventDefault`. Nada disso pode
// ser exercitado com objetos de mentira.
//
// Três famílias de bug já saíram daqui e cada uma tem caso abaixo:
//  - dois hooks montados ao mesmo tempo → uma tecla, duas ações;
//  - o espaço dentro de um campo de texto virando "OK" ("ESPN 2" ficava "ESPN");
//  - `enabled` que não desliga de fato.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useTVNavigation } from './useTVNavigation';

interface SondaProps {
    onNavigate?: (d: 'up' | 'down' | 'left' | 'right') => void;
    onEnter?: (fromInput?: boolean) => void;
    onBack?: () => void;
    onAction?: (a: string) => void;
    enabled?: boolean;
    comInput?: boolean;
}

function Sonda({ comInput, ...opcoes }: SondaProps) {
    useTVNavigation(opcoes);
    return comInput ? <input data-testid="campo" defaultValue="ESPN" /> : <div />;
}

/** Dispara uma tecla como a TV dispara: por `key` OU por `keyCode`. */
function tecla(
    valor: string | number,
    alvo: EventTarget = window
): KeyboardEvent {
    const evento = new KeyboardEvent('keydown', {
        key: typeof valor === 'string' ? valor : '',
        keyCode: typeof valor === 'number' ? valor : 0,
        bubbles: true,
        cancelable: true,
    });
    alvo.dispatchEvent(evento);
    return evento;
}

afterEach(cleanup);

describe('setas', () => {
    let onNavigate: SondaProps['onNavigate'] & { mock: { calls: unknown[][] } };
    beforeEach(() => {
        onNavigate = vi.fn() as typeof onNavigate;
        render(<Sonda onNavigate={onNavigate} />);
    });

    it.each([
        ['ArrowUp', 'up'], ['ArrowDown', 'down'],
        ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
    ])('%s vira %s', (key, direcao) => {
        tecla(key);
        expect(onNavigate).toHaveBeenCalledWith(direcao);
    });

    // Controle Samsung antigo manda keyCode, não `key`.
    it.each([[38, 'up'], [40, 'down'], [37, 'left'], [39, 'right']])(
        'keyCode %d vira %s', (code, direcao) => {
            tecla(code);
            expect(onNavigate).toHaveBeenCalledWith(direcao);
        });

    it('cancela o evento pra página não rolar por baixo', () => {
        expect(tecla('ArrowDown').defaultPrevented).toBe(true);
    });
});

describe('OK e Voltar', () => {
    // Cada um destes é um controle diferente na casa de alguém.
    it.each(['Enter', 13, 29443, ' ', 32, 'Select'])('%s é OK', (valor) => {
        const onEnter = vi.fn();
        render(<Sonda onEnter={onEnter} />);
        tecla(valor);
        expect(onEnter).toHaveBeenCalled();
    });

    it.each([10009, 461, 'XF86Back', 'Escape'])('%s é Voltar', (valor) => {
        const onBack = vi.fn();
        render(<Sonda onBack={onBack} />);
        tecla(valor);
        expect(onBack).toHaveBeenCalled();
    });

    // BUG REAL: Backspace solto fechava campo/tela em qualquer build. Um
    // teclado de verdade (desktop, ou bluetooth numa TV) usa Backspace pra
    // apagar caractere — interceptar isso como "Voltar" tornava impossível
    // corrigir um typo digitando. Fora de build de TV, Backspace/tecla 8
    // soltos não fazem mais nada aqui.
    it.each(['Backspace', 8])('%s solto NÃO é Voltar fora de build de TV', (valor) => {
        const onBack = vi.fn();
        render(<Sonda onBack={onBack} />);
        tecla(valor);
        expect(onBack).not.toHaveBeenCalled();
    });

    it('OK também chega em onAction', () => {
        const onAction = vi.fn();
        render(<Sonda onAction={onAction} />);
        tecla('Enter');
        expect(onAction).toHaveBeenCalledWith('enter');
    });
});

describe('teclas coloridas e de mídia', () => {
    it.each([
        ['ColorF0Red', 'red'], [403, 'red'],
        ['ColorF1Green', 'green'], [404, 'green'],
        ['ColorF2Yellow', 'yellow'], [405, 'yellow'],
        ['ColorF3Blue', 'blue'], [406, 'blue'],
        ['MediaPlayPause', 'play'], [415, 'play'],
        [19, 'pause'], [413, 'stop'],
    ])('%s vira %s', (valor, acao) => {
        const onAction = vi.fn();
        render(<Sonda onAction={onAction} />);
        tecla(valor);
        expect(onAction).toHaveBeenCalledWith(acao);
    });

    // Fallback de teclado pras cores do controle: um teclado comum não tem
    // tecla física de vermelho/verde/amarelo/azul.
    it.each([
        ['1', 'red'], ['2', 'green'], ['3', 'yellow'], ['4', 'blue'],
    ])('%s (fallback de teclado) vira %s', (valor, acao) => {
        const onAction = vi.fn();
        render(<Sonda onAction={onAction} />);
        tecla(valor);
        expect(onAction).toHaveBeenCalledWith(acao);
    });
});

// O caminho legado só existe pra controle remoto de verdade — não pode
// vazar pra build web/desktop (é o bug que o teste acima cobre).
describe('Backspace legado só em build de TV', () => {
    it('Backspace vira Voltar quando naTV() diz que é TV', async () => {
        vi.doMock('../services/platformApp', () => ({ naTV: () => true }));
        vi.resetModules();
        const { useTVNavigation: useTVNavigationTV } = await import('./useTVNavigation');
        function SondaTV({ onBack }: { onBack: () => void }) {
            useTVNavigationTV({ onBack });
            return <div />;
        }
        const onBack = vi.fn();
        render(<SondaTV onBack={onBack} />);
        tecla('Backspace');
        expect(onBack).toHaveBeenCalled();
        vi.doUnmock('../services/platformApp');
        vi.resetModules();
    });
});

describe('enabled', () => {
    it('desligado não escuta nada', () => {
        const onNavigate = vi.fn();
        const onEnter = vi.fn();
        const onBack = vi.fn();
        render(<Sonda enabled={false} onNavigate={onNavigate} onEnter={onEnter} onBack={onBack} />);
        tecla('ArrowDown');
        tecla('Enter');
        tecla(10009);
        expect(onNavigate).not.toHaveBeenCalled();
        expect(onEnter).not.toHaveBeenCalled();
        expect(onBack).not.toHaveBeenCalled();
    });

    // A armadilha mais recorrente do projeto: o listener é GLOBAL, então dois
    // hooks montados ao mesmo tempo transformam uma tecla em duas ações — um
    // OK que "abre a ficha" e "dá play" no mesmo toque.
    it('dois hooks ligados = a MESMA tecla contada duas vezes', () => {
        const debaixo = vi.fn();
        const emCima = vi.fn();
        render(<><Sonda onEnter={debaixo} /><Sonda onEnter={emCima} /></>);
        tecla('Enter');
        expect(debaixo).toHaveBeenCalledTimes(1);
        expect(emCima).toHaveBeenCalledTimes(1);
    });

    it('é por isso que o de baixo precisa ser desligado', () => {
        const debaixo = vi.fn();
        const emCima = vi.fn();
        render(<><Sonda enabled={false} onEnter={debaixo} /><Sonda onEnter={emCima} /></>);
        tecla('Enter');
        expect(debaixo).not.toHaveBeenCalled();
        expect(emCima).toHaveBeenCalledTimes(1);
    });

    it('desmontar leva o listener junto', () => {
        const onEnter = vi.fn();
        const { unmount } = render(<Sonda onEnter={onEnter} />);
        unmount();
        tecla('Enter');
        expect(onEnter).not.toHaveBeenCalled();
    });
});

describe('dentro de um campo de texto (IME do Tizen)', () => {
    function comCampo(opcoes: SondaProps = {}) {
        const { getByTestId } = render(<Sonda comInput {...opcoes} />);
        const campo = getByTestId('campo') as HTMLInputElement;
        campo.focus();
        return campo;
    }

    // BUG REAL: o espaço é OK no controle e TEXTO no teclado. Tratado como OK
    // dentro do campo, buscar "ESPN 2" fechava o teclado em "ESPN".
    it('espaço dentro do campo é texto, não OK', () => {
        const onEnter = vi.fn();
        const campo = comCampo({ onEnter });
        tecla(' ', campo);
        tecla(32, campo);
        expect(onEnter).not.toHaveBeenCalled();
    });

    it('as setas ficam com o IME nativo', () => {
        const onNavigate = vi.fn();
        const campo = comCampo({ onNavigate });
        tecla('ArrowLeft', campo);
        tecla('ArrowRight', campo);
        expect(onNavigate).not.toHaveBeenCalled();
    });

    // OK de verdade fecha o teclado — e avisa a página de onde veio, senão
    // ela reabre a busca e o IME do Tizen fica piscando sem saída.
    it('OK fecha o teclado e diz que veio do campo', () => {
        const onEnter = vi.fn();
        const campo = comCampo({ onEnter });
        tecla('Enter', campo);
        expect(onEnter).toHaveBeenCalledWith(true);
        expect(document.activeElement).not.toBe(campo);
    });

    it('Voltar sai do campo', () => {
        const onBack = vi.fn();
        const campo = comCampo({ onBack });
        tecla(10009, campo);
        expect(onBack).toHaveBeenCalled();
        expect(document.activeElement).not.toBe(campo);
    });

    // BUG REAL: Backspace dentro do campo fechava o campo inteiro em vez de
    // apagar um caractere — corrigir um typo era impossível com teclado de
    // verdade. Backspace precisa continuar com foco no campo pro navegador
    // apagar o caractere normalmente.
    it('Backspace apaga caractere, não fecha o campo', () => {
        const onBack = vi.fn();
        const campo = comCampo({ onBack });
        tecla('Backspace', campo);
        expect(onBack).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(campo);
    });

    it('Escape sai do campo (padrão de desktop)', () => {
        const onBack = vi.fn();
        const campo = comCampo({ onBack });
        tecla('Escape', campo);
        expect(onBack).toHaveBeenCalled();
        expect(document.activeElement).not.toBe(campo);
    });
});

describe('tizenhwkey', () => {
    // A TV manda este evento quando o teclado nativo está aberto; sem tirar o
    // foco do campo, o teclado não fecha.
    it('a tecla de hardware tira o foco do campo', () => {
        const { getByTestId } = render(<Sonda comInput />);
        const campo = getByTestId('campo') as HTMLInputElement;
        campo.focus();
        expect(document.activeElement).toBe(campo);

        const evento = new Event('tizenhwkey') as Event & { keyName?: string };
        evento.keyName = 'back';
        window.dispatchEvent(evento);

        expect(document.activeElement).not.toBe(campo);
    });
});
