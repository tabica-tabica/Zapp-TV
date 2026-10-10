// Escolha de gênero de Filmes/Séries: todos os gêneros de uma vez, em chips.
// Substitui o botão que CICLAVA um gênero por clique/OK — chegar no 12º era
// apertar 12 vezes. Mouse clica direto; no controle, ←→↑↓ andam pelos chips,
// OK escolhe e Voltar fecha.

import { useState } from 'react';
import { FaLock, FaTheaterMasks, FaTimes } from 'react-icons/fa';
import type { Genero } from '../services/catalogGenres';
import { useTVNavigation } from '../hooks/useTVNavigation';
import './GenrePicker.css';

/** Chips por linha — o CSS fixa a mesma largura (25%), então ↑↓ pulam isso. */
const COLUNAS = 4;

interface GenrePickerProps {
    generos: Genero[];
    /** null = todos */
    selecionado: string | null;
    onEscolher: (id: string | null) => void;
    onFechar: () => void;
    /** Gêneros que vão pedir PIN (cadeado no chip) */
    bloqueados?: ReadonlySet<string>;
}

export function GenrePicker({ generos, selecionado, onEscolher, onFechar, bloqueados }: GenrePickerProps) {
    // Chip 0 = "Todos"; os demais seguem a ordem de `generos`
    const opcoes: Array<{ id: string | null; rotulo: string }> = [
        { id: null, rotulo: 'Todos' },
        ...generos.map(g => ({ id: g.id, rotulo: g.rotulo })),
    ];
    const [foco, setFoco] = useState(() => Math.max(0, opcoes.findIndex(o => o.id === selecionado)));

    const escolher = (id: string | null) => {
        onEscolher(id);
        onFechar();
    };

    useTVNavigation({
        onNavigate: (direcao) => {
            const passo = direcao === 'left' ? -1 : direcao === 'right' ? 1 : direcao === 'up' ? -COLUNAS : COLUNAS;
            setFoco(atual => Math.min(opcoes.length - 1, Math.max(0, atual + passo)));
        },
        onEnter: () => escolher(opcoes[foco].id),
        onBack: onFechar,
    });

    return (
        <div className="genre-picker-backdrop" onClick={onFechar}>
            <div className="genre-picker" role="dialog" aria-label="Escolher gênero" onClick={e => e.stopPropagation()}>
                <div className="genre-picker-header">
                    <span><FaTheaterMasks /> Gênero</span>
                    <button className="genre-picker-close" onClick={onFechar} aria-label="Fechar"><FaTimes /></button>
                </div>
                <div className="genre-picker-chips">
                    {opcoes.map((opcao, index) => (
                        <button
                            key={opcao.id ?? 'todos'}
                            className={[
                                'genre-chip',
                                opcao.id === selecionado ? 'selected' : '',
                                index === foco ? 'tv-focused' : '',
                            ].filter(Boolean).join(' ')}
                            onClick={() => escolher(opcao.id)}
                            onMouseEnter={() => setFoco(index)}
                        >
                            {opcao.id && bloqueados?.has(opcao.id) && <FaLock className="genre-chip-lock" />}
                            <span>{opcao.rotulo}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
