// Exportar/importar a Minha Lista (🟢 na página, ou o botão do cabeçalho).
// Mesmo esquema da lista secreta: na TV, a lista em páginas de QR (→←) e
// um campo pra colar o texto de cada página (pelo teclado do app de
// controle remoto no celular); no computador, também arquivo .json.
// Visual do QR e do campo: as classes da lista secreta (SecretList.css).

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { FaDownload, FaUpload, FaPaste, FaQrcode, FaTimes } from 'react-icons/fa';
import { exportarMinhaLista, exportarMinhaListaQr, importarMinhaLista, type ResultadoMinhaLista } from '../services/myListTransfer';
import { desenharQr } from '../utils/qrPath';
import { useTVNavigation } from '../hooks/useTVNavigation';
import './SecretList.css';

/** TV não baixa nem escolhe arquivo: lá só o QR. */
const TEM_ARQUIVO = __BUILD_TARGET__ !== 'tizen' && __BUILD_TARGET__ !== 'webos';

const resumo = (r: Pick<ResultadoMinhaLista, 'novos' | 'listas'>) =>
    `Importado: ${r.novos} item(ns) novo(s)${r.listas ? `, ${r.listas} lista(s) criada(s)` : ''}.`;

interface MyListTransferProps {
    onClose: () => void;
    /** Algo foi importado: a página recarrega a lista e as abas */
    onImported: () => void;
}

export function MyListTransfer({ onClose, onImported }: MyListTransferProps) {
    const [paginas] = useState(() => exportarMinhaListaQr());
    const [pagina, setPagina] = useState(0);
    // Lista vazia: não há QR pra mostrar, abre direto no colar
    const [colando, setColando] = useState(paginas.length === 0);
    const [colado, setColado] = useState('');
    const [aviso, setAviso] = useState('');
    const colarRef = useRef<HTMLInputElement>(null);
    const arquivoRef = useRef<HTMLInputElement>(null);
    // Abriu direto no colar (lista vazia): o campo já vem focado
    useEffect(() => {
        if (paginas.length === 0) colarRef.current?.focus();
    }, [paginas.length]);

    const abrirColar = () => {
        setColando(true);
        setColado('');
        setAviso('');
        setTimeout(() => colarRef.current?.focus(), 0);
    };

    const importarColado = () => {
        const texto = colado.trim();
        if (!texto) { colarRef.current?.focus(); return; }
        const r = importarMinhaLista(texto);
        setAviso(r.ok ? `${resumo(r)} OK cola a próxima página.` : `Não deu: ${r.error}`);
        setColado('');
        if (r.ok) onImported();
    };

    const exportarArquivo = () => {
        const url = URL.createObjectURL(new Blob([exportarMinhaLista()], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'minha-lista.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const importarArquivos = async (e: ChangeEvent<HTMLInputElement>) => {
        const arquivos = Array.from(e.target.files ?? []);
        e.target.value = '';
        const total = { novos: 0, listas: 0 };
        let erro = '';
        for (const arquivo of arquivos) {
            const r = importarMinhaLista(await arquivo.text());
            if (!r.ok) erro = `${arquivo.name}: ${r.error}`;
            total.novos += r.novos;
            total.listas += r.listas;
        }
        setAviso(erro || resumo(total));
        onImported();
    };

    useTVNavigation({
        onNavigate: (direcao) => {
            if (colando || (direcao !== 'left' && direcao !== 'right')) return;
            setPagina(p => Math.min(paginas.length - 1, Math.max(0, p + (direcao === 'right' ? 1 : -1))));
        },
        onEnter: (fromInput) => {
            if (!colando) { onClose(); return; }
            // OK dentro do campo: importa. OK fora: reabre o teclado pra próxima
            if (fromInput) importarColado(); else colarRef.current?.focus();
        },
        onAction: (acao) => {
            if (acao === 'green') abrirColar();
            else if (acao === 'blue' && paginas.length > 0) setColando(false);
        },
        onBack: () => {
            if (colando && paginas.length > 0) setColando(false);
            else onClose();
        },
    });

    const qr = !colando && paginas.length > 0 ? desenharQr(paginas[pagina]) : null;
    const lado = qr ? qr.count + 4 : 0;

    return (
        <div className="mylist-overlay">
            <div className="mylist-overlay-painel" role="dialog" aria-label="Exportar e importar a Minha Lista">
                <div className="secret-list-header">
                    <span>Exportar / importar a Minha Lista</span>
                    <span>
                        {TEM_ARQUIVO && (
                            <>
                                <button className="secret-list-close" onClick={exportarArquivo} title="Exportar arquivo"><FaDownload /></button>
                                <button className="secret-list-close" onClick={() => arquivoRef.current?.click()} title="Importar arquivo"><FaUpload /></button>
                                <input ref={arquivoRef} type="file" accept=".json,.txt,application/json,text/plain" multiple hidden onChange={importarArquivos} />
                            </>
                        )}
                        <button className="secret-list-close" onClick={abrirColar} title="Colar texto do QR (🟢)"><FaPaste /></button>
                        {paginas.length > 0 && (
                            <button className="secret-list-close" onClick={() => setColando(false)} title="Exportar em QR (🔵)"><FaQrcode /></button>
                        )}
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
                            O que já está na lista não duplica. Voltar sai.
                        </p>
                    </div>
                ) : qr && (
                    <div className="secret-qr">
                        <svg viewBox={`-2 -2 ${lado} ${lado}`} shapeRendering="crispEdges">
                            <rect x="-2" y="-2" width={lado} height={lado} fill="#fff" />
                            <path d={qr.path} fill="#000" />
                        </svg>
                        <p>
                            Página {pagina + 1} de {paginas.length}{paginas.length > 1 ? ' · →← troca' : ''}.
                            Guarde o texto de cada código no celular. Para trazer de volta (nesta ou noutra TV):
                            🟢 e cole, ou salve como .txt e use Importar no computador. Sem capas.
                        </p>
                    </div>
                )}

                <div className="secret-list-hints">
                    {paginas.length > 1 && <span>→← páginas</span>}
                    <span>🟢 colar</span>
                    {paginas.length > 0 && <span>🔵 QR</span>}
                    <span>Voltar fecha</span>
                </div>
            </div>
        </div>
    );
}
