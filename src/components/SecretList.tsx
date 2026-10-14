// Lista secreta (só abre depois do PIN, pela barra de Filmes): os filmes
// adultos guardados e os MOMENTOS de cada um, em chips de tempo.
//
// Mouse: clicar no filme toca do primeiro momento; num chip, toca dali;
// 🗑 tira o filme e × tira o momento. Controle: ↑↓ entre filmes, →← entre
// os chips do filme, OK toca, 🔴 remove o que está em foco, Voltar fecha.
// 🔵 mostra a lista em QR (sem miniaturas, em páginas →←). No computador,
// Exportar/Importar baixa e lê o arquivo — inclusive o texto lido dos QRs.
// 🟢 abre um campo pra colar o texto de cada QR (na TV, pelo teclado do app
// de controle remoto no celular: LG ThinQ / SmartThings). OK importa a página.

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { FaFire, FaPlay, FaTimes, FaTrashAlt, FaFilm, FaQrcode, FaDownload, FaUpload, FaPaste } from 'react-icons/fa';
import {
    secretList, formatMoment, exportarSecreta, exportarSecretaQr, importarSecreta, type ItemSecreto,
} from '../services/secretList';
import { desenharQr } from '../utils/qrPath';
import { posterThumb } from '../services/tmdb';
import { useTVNavigation } from '../hooks/useTVNavigation';
import './SecretList.css';

/** TV não baixa nem escolhe arquivo: lá só o QR. */
const TEM_ARQUIVO = __BUILD_TARGET__ !== 'tizen' && __BUILD_TARGET__ !== 'webos';

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
    // O foco do controle precisa ficar À VISTA: a lista rola por dentro e,
    // sem isto, ↑↓ levavam o foco pra fora da tela e parecia que travou
    const linhasRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        linhasRef.current?.querySelector('.tv-focused')?.scrollIntoView({ block: 'nearest' });
    }, [linha, coluna, itens]);

    const recarregar = () => {
        const novos = secretList.list();
        setItens(novos);
        setLinha(l => Math.min(l, Math.max(0, novos.length - 1)));
        setColuna(0);
    };

    // null = lista; número = página do QR aberta
    const [qrPaginas, setQrPaginas] = useState<string[] | null>(null);
    const [qrPagina, setQrPagina] = useState(0);
    const [aviso, setAviso] = useState('');
    const arquivoRef = useRef<HTMLInputElement>(null);
    // Colar: o texto de um QR por vez, vindo do teclado do celular
    const [colando, setColando] = useState(false);
    const [colado, setColado] = useState('');
    const colarRef = useRef<HTMLInputElement>(null);

    const abrirColar = () => {
        setQrPaginas(null);
        setColando(true);
        setColado('');
        setAviso('');
        setTimeout(() => colarRef.current?.focus(), 0);
    };

    const importarColado = () => {
        const texto = colado.trim();
        if (!texto) { colarRef.current?.focus(); return; }
        const r = importarSecreta(texto);
        setAviso(r.ok
            ? `Importado: ${r.novos} filme(s), ${r.momentos} momento(s) novos. OK cola a próxima página.`
            : `Não deu: ${r.error}`);
        setColado('');
        recarregar();
    };

    const exportarArquivo = () => {
        const url = URL.createObjectURL(new Blob([exportarSecreta()], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'lista-secreta.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const importarArquivos = async (e: ChangeEvent<HTMLInputElement>) => {
        const arquivos = Array.from(e.target.files ?? []);
        e.target.value = '';
        let novos = 0, momentos = 0, erro = '';
        for (const arquivo of arquivos) {
            const r = importarSecreta(await arquivo.text());
            if (!r.ok) erro = `${arquivo.name}: ${r.error}`;
            novos += r.novos;
            momentos += r.momentos;
        }
        setAviso(erro || `Importado: ${novos} filme(s), ${momentos} momento(s) novos.`);
        recarregar();
    };

    const tocar = (indice: number, momento: number | null) => onPlay(itens, indice, momento);
    const abrirQr = () => {
        if (itens.length === 0) return;
        setQrPaginas(exportarSecretaQr());
        setQrPagina(0);
    };

    const removerFilme = (id: string) => { secretList.remove(id); recarregar(); };
    const removerMomento = (id: string, t: number) => { secretList.removeMoment(id, t); recarregar(); };

    useTVNavigation({
        onNavigate: (direcao) => {
            if (colando) return;
            if (qrPaginas) {
                if (direcao === 'left' || direcao === 'right') {
                    setQrPagina(p => Math.min(qrPaginas.length - 1, Math.max(0, p + (direcao === 'right' ? 1 : -1))));
                }
                return;
            }
            if (itens.length === 0) return;
            if (direcao === 'up' || direcao === 'down') {
                setLinha(l => Math.min(itens.length - 1, Math.max(0, l + (direcao === 'down' ? 1 : -1))));
                setColuna(0);
            } else {
                const max = itens[linha]?.moments.length ?? 0;
                setColuna(c => Math.min(max, Math.max(0, c + (direcao === 'right' ? 1 : -1))));
            }
        },
        onEnter: (fromInput) => {
            if (colando) {
                // OK dentro do campo: importa. OK fora: reabre o teclado pra próxima
                if (fromInput) importarColado(); else colarRef.current?.focus();
                return;
            }
            if (qrPaginas) { setQrPaginas(null); return; }
            const item = itens[linha];
            if (!item) return;
            tocar(linha, coluna > 0 ? item.moments[coluna - 1] : null);
        },
        onAction: (acao) => {
            if (acao === 'blue') { setColando(false); abrirQr(); return; }
            if (acao === 'green') { abrirColar(); return; }
            if (acao !== 'red' || qrPaginas || colando) return;
            const item = itens[linha];
            if (!item) return;
            if (coluna > 0) removerMomento(item.id, item.moments[coluna - 1]);
            else removerFilme(item.id);
        },
        onBack: () => {
            if (colando) setColando(false);
            else if (qrPaginas) setQrPaginas(null);
            else onClose();
        },
    });

    return (
        <div className="secret-list-backdrop">
            <div className="secret-list" role="dialog" aria-label="Lista secreta">
                <div className="secret-list-header">
                    <span><FaFire /> Lista secreta</span>
                    <span>
                        {TEM_ARQUIVO && (
                            <>
                                <button className="secret-list-close" onClick={exportarArquivo} title="Exportar arquivo"><FaDownload /></button>
                                <button className="secret-list-close" onClick={() => arquivoRef.current?.click()} title="Importar arquivo"><FaUpload /></button>
                                <input ref={arquivoRef} type="file" accept=".json,.txt,application/json,text/plain" multiple hidden onChange={importarArquivos} />
                            </>
                        )}
                        <button className="secret-list-close" onClick={abrirColar} title="Colar texto do QR (🟢)"><FaPaste /></button>
                        <button className="secret-list-close" onClick={() => { setColando(false); abrirQr(); }} title="Exportar em QR (🔵)"><FaQrcode /></button>
                        <button className="secret-list-close" onClick={onClose} aria-label="Fechar"><FaTimes /></button>
                    </span>
                </div>

                {aviso && <p className="secret-list-aviso">{aviso}</p>}

                {colando ? (
                    <div className="secret-colar">
                        <input
                            ref={colarRef}
                            type="text"
                            value={colado}
                            onChange={e => setColado(e.target.value)}
                            placeholder="Cole aqui o texto de um QR"
                            aria-label="Texto do QR"
                        />
                        <button onClick={importarColado}>Importar</button>
                        <p>
                            No celular, copie o texto de uma página do QR e cole pelo teclado do app de
                            controle remoto (LG ThinQ / SmartThings). OK importa; repita para cada página.
                            Voltar sai.
                        </p>
                    </div>
                ) : qrPaginas ? (() => {
                    const { count, path } = desenharQr(qrPaginas[qrPagina]);
                    const lado = count + 4;
                    return (
                        <div className="secret-qr">
                            <svg viewBox={`-2 -2 ${lado} ${lado}`} shapeRendering="crispEdges">
                                <rect x="-2" y="-2" width={lado} height={lado} fill="#fff" />
                                <path d={path} fill="#000" />
                            </svg>
                            <p>
                                Página {qrPagina + 1} de {qrPaginas.length}{qrPaginas.length > 1 ? ' · →← troca' : ''}.
                                Guarde o texto de cada código no celular. Para trazer de volta: 🟢 e cole
                                na TV, ou salve como .txt e use Importar no computador.
                                Sem miniaturas.
                            </p>
                        </div>
                    );
                })() : itens.length === 0 ? (
                    <p className="secret-list-empty">
                        Nenhum filme ainda. Adicione filmes adultos pelo menu Ações (🟡) ou pela ficha do filme.
                    </p>
                ) : (
                    <div ref={linhasRef} className="secret-list-rows">
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
                    <span>🔵 QR</span>
                    <span>🟢 colar</span>
                    <span>Voltar fecha</span>
                </div>
            </div>
        </div>
    );
}
