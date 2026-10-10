// Lista secreta (só abre depois do PIN, pela barra de Filmes): os filmes
// adultos guardados e os MOMENTOS de cada um, em chips de tempo.
//
// Mouse: clicar no filme toca do primeiro momento; num chip, toca dali;
// 🗑 tira o filme e × tira o momento. Controle: ↑↓ entre filmes, →← entre
// os chips do filme, OK toca, 🔴 remove o que está em foco, Voltar fecha.

import { useState } from 'react';
import { FaLock, FaPlay, FaTimes, FaTrashAlt, FaFilm } from 'react-icons/fa';
import { secretList, formatMoment, type ItemSecreto } from '../services/secretList';
import { posterThumb } from '../services/tmdb';
import { useTVNavigation } from '../hooks/useTVNavigation';
import './SecretList.css';

interface SecretListProps {
    onClose: () => void;
    /** Toca: a lista atual (ordem de ⏮/⏭), o índice e o momento escolhido */
    onPlay: (itens: ItemSecreto[], indice: number, momento: number | null) => void;
}

export function SecretList({ onClose, onPlay }: SecretListProps) {
    const [itens, setItens] = useState<ItemSecreto[]>(() => secretList.list());
    // coluna 0 = o filme; 1..n = os chips de momento dele
    const [linha, setLinha] = useState(0);
    const [coluna, setColuna] = useState(0);

    const recarregar = () => {
        const novos = secretList.list();
        setItens(novos);
        setLinha(l => Math.min(l, Math.max(0, novos.length - 1)));
        setColuna(0);
    };

    const tocar = (indice: number, momento: number | null) => onPlay(itens, indice, momento);
    const removerFilme = (id: string) => { secretList.remove(id); recarregar(); };
    const removerMomento = (id: string, t: number) => { secretList.removeMoment(id, t); recarregar(); };

    useTVNavigation({
        onNavigate: (direcao) => {
            if (itens.length === 0) return;
            if (direcao === 'up' || direcao === 'down') {
                setLinha(l => Math.min(itens.length - 1, Math.max(0, l + (direcao === 'down' ? 1 : -1))));
                setColuna(0);
            } else {
                const max = itens[linha]?.moments.length ?? 0;
                setColuna(c => Math.min(max, Math.max(0, c + (direcao === 'right' ? 1 : -1))));
            }
        },
        onEnter: () => {
            const item = itens[linha];
            if (!item) return;
            tocar(linha, coluna > 0 ? item.moments[coluna - 1] : null);
        },
        onAction: (acao) => {
            if (acao !== 'red') return;
            const item = itens[linha];
            if (!item) return;
            if (coluna > 0) removerMomento(item.id, item.moments[coluna - 1]);
            else removerFilme(item.id);
        },
        onBack: onClose,
    });

    return (
        <div className="secret-list-backdrop">
            <div className="secret-list" role="dialog" aria-label="Lista secreta">
                <div className="secret-list-header">
                    <span><FaLock /> Lista secreta</span>
                    <button className="secret-list-close" onClick={onClose} aria-label="Fechar"><FaTimes /></button>
                </div>

                {itens.length === 0 ? (
                    <p className="secret-list-empty">
                        Nenhum filme ainda. Adicione filmes adultos pelo menu Ações (🟡) ou pela ficha do filme.
                    </p>
                ) : (
                    <div className="secret-list-rows">
                        {itens.map((item, i) => (
                            <div key={item.id} className={`secret-row ${i === linha ? 'current' : ''}`}>
                                <button
                                    className={`secret-movie ${i === linha && coluna === 0 ? 'tv-focused' : ''}`}
                                    onClick={() => tocar(i, null)}
                                    onMouseEnter={() => { setLinha(i); setColuna(0); }}
                                    title={item.moments.length > 0 ? 'Tocar do primeiro momento' : 'Tocar do começo'}
                                >
                                    <span className="secret-poster">
                                        {item.poster ? <img src={posterThumb(item.poster)} alt="" loading="lazy" /> : <FaFilm />}
                                    </span>
                                    <span className="secret-title">{item.title}</span>
                                    <FaPlay className="secret-play" />
                                </button>
                                <div className="secret-moments">
                                    {item.moments.length === 0 && (
                                        <span className="secret-no-moments">sem momentos — 🟢 marca no player</span>
                                    )}
                                    {item.moments.map((t, j) => (
                                        <span
                                            key={t}
                                            className={`secret-chip ${item.thumbs?.[String(t)] ? 'with-thumb' : ''} ${i === linha && coluna === j + 1 ? 'tv-focused' : ''}`}
                                            onMouseEnter={() => { setLinha(i); setColuna(j + 1); }}
                                        >
                                            <button className="secret-chip-time" onClick={() => tocar(i, t)}>
                                                {item.thumbs?.[String(t)] && (
                                                    <img className="secret-chip-thumb" src={item.thumbs[String(t)]} alt="" />
                                                )}
                                                <span>{formatMoment(t)}</span>
                                            </button>
                                            <button
                                                className="secret-chip-remove"
                                                onClick={() => removerMomento(item.id, t)}
                                                aria-label={`Remover momento ${formatMoment(t)}`}
                                            ><FaTimes /></button>
                                        </span>
                                    ))}
                                </div>
                                <button
                                    className="secret-remove"
                                    onClick={() => removerFilme(item.id)}
                                    title="Tirar da lista secreta"
                                ><FaTrashAlt /></button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="secret-list-hints">
                    <span>↑↓ filmes · →← momentos</span>
                    <span>OK toca</span>
                    <span>🔴 remove</span>
                    <span>Voltar fecha</span>
                </div>
            </div>
        </div>
    );
}
