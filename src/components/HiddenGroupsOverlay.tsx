// Gerenciar categorias de canais curadas ocultas por padrão (curiosidades,
// treino/aulas/receitas, câmeras, rádios, shows, maratonas 24h etc.) — aberto
// de Settings.tsx. Fora do array FocusZone fixo da página (como
// WrappedOverlay/QrBackupOverlay): a lista de resultado de busca tem tamanho
// variável (até centenas de itens num grupo só), o que não cabe no modelo de
// zonas fixas que Settings.tsx usa pro resto da página. Modelado em
// ChannelAgendaOverlay.tsx — lista rolável com foco por D-pad.
//
// Os "grupos" mostrados aqui são DETECTADOS dinamicamente (não uma lista
// fixa): cada categoria real da playlist ativa que bate num padrão genérico
// de "ruído" (ver curatedHiddenGroups.ts) vira 1 linha. A busca mostra canais
// de QUALQUER grupo detectado, oculto ou visível, com toggle na direção que
// faltar — dá pra ocultar 1 canal específico de um grupo visível, ou revelar
// 1 canal específico de um grupo oculto.

import { useEffect, useMemo, useRef, useState } from 'react';
import { FaTimes, FaSearch, FaCheckSquare, FaRegSquare } from 'react-icons/fa';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { readCatalog, type CachedLiveStream } from '../services/catalogCache';
import { normalizeSearch } from '../services/catalogExtras';
import {
    detectJunkCategories, detectQualityOnlyCategories, isQualityTaggedChannel,
    curatedHiddenPrefs, computeEffectiveVisibility, toggleOverride,
    type DetectedGroup,
} from '../services/curatedHiddenGroups';
import './HiddenGroupsOverlay.css';

interface HiddenGroupsOverlayProps {
    onClose: () => void;
}

interface CachedCategory {
    category_id: string;
    category_name: string;
}

type Row =
    | { kind: 'group'; categoryId: string; label: string; count: number; unhidden: boolean }
    | { kind: 'channel'; streamId: number; name: string; categoryId: string; unhidden: boolean };

const MAX_SEARCH_RESULTS = 60;

export function HiddenGroupsOverlay({ onClose }: HiddenGroupsOverlayProps) {
    const [catalog] = useState<CachedLiveStream[]>(() => readCatalog<CachedLiveStream>('live') || []);
    const [categories] = useState<CachedCategory[]>(() => readCatalog<CachedCategory>('live-cats') || []);
    const [unhiddenGroups, setUnhiddenGroups] = useState(() => curatedHiddenPrefs.getUnhiddenGroups());
    const [overrides, setOverrides] = useState(() => curatedHiddenPrefs.getChannelOverrides());
    const [query, setQuery] = useState('');
    const [editing, setEditing] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(-1); // -1 = campo de busca
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Categorias "ruído" detectadas na playlist ativa — computado uma vez (a
    // lista de categorias não muda enquanto o overlay está aberto).
    const detectedGroups: DetectedGroup[] = useMemo(() => detectJunkCategories(categories), [categories]);

    // Cada canal do catálogo que pertence a uma categoria detectada.
    const channelsByCategory = useMemo(() => {
        const byCategory = new Map<string, CachedLiveStream[]>();
        for (const group of detectedGroups) byCategory.set(group.categoryId, []);
        for (const channel of catalog) {
            if (byCategory.has(channel.category_id)) byCategory.get(channel.category_id)!.push(channel);
        }
        return byCategory;
    }, [detectedGroups, catalog]);

    // Categorias "só com tag de qualidade" (Esportes): não entram na lista de
    // blocos acima (o padrão é POR CANAL, não um boolean único pro grupo) —
    // só aparecem quando a busca acha um canal delas.
    const qualityOnlyGroups: DetectedGroup[] = useMemo(() => detectQualityOnlyCategories(categories), [categories]);
    const qualityOnlyCategoryIds = useMemo(() => new Set(qualityOnlyGroups.map(g => g.categoryId)), [qualityOnlyGroups]);
    const qualityOnlyChannelsByCategory = useMemo(() => {
        const byCategory = new Map<string, CachedLiveStream[]>();
        for (const group of qualityOnlyGroups) byCategory.set(group.categoryId, []);
        for (const channel of catalog) {
            if (byCategory.has(channel.category_id)) byCategory.get(channel.category_id)!.push(channel);
        }
        return byCategory;
    }, [qualityOnlyGroups, catalog]);

    const normalizedQuery = normalizeSearch(query);
    const searching = normalizedQuery.length >= 2;

    const rows: Row[] = useMemo(() => {
        if (!searching) {
            return detectedGroups.map(group => ({
                kind: 'group' as const,
                categoryId: group.categoryId,
                label: group.categoryName,
                count: channelsByCategory.get(group.categoryId)?.length || 0,
                unhidden: unhiddenGroups.has(group.categoryId),
            }));
        }
        const results: Row[] = [];
        for (const group of detectedGroups) {
            for (const channel of channelsByCategory.get(group.categoryId) || []) {
                if (!normalizeSearch(channel.name).includes(normalizedQuery)) continue;
                const defaultVisible = unhiddenGroups.has(group.categoryId);
                results.push({
                    kind: 'channel',
                    streamId: channel.stream_id,
                    name: channel.name,
                    categoryId: group.categoryId,
                    unhidden: computeEffectiveVisibility(channel.stream_id, defaultVisible, overrides),
                });
                if (results.length >= MAX_SEARCH_RESULTS) return results;
            }
        }
        for (const group of qualityOnlyGroups) {
            for (const channel of qualityOnlyChannelsByCategory.get(group.categoryId) || []) {
                if (!normalizeSearch(channel.name).includes(normalizedQuery)) continue;
                const defaultVisible = isQualityTaggedChannel(channel.name);
                results.push({
                    kind: 'channel',
                    streamId: channel.stream_id,
                    name: channel.name,
                    categoryId: group.categoryId,
                    unhidden: computeEffectiveVisibility(channel.stream_id, defaultVisible, overrides),
                });
                if (results.length >= MAX_SEARCH_RESULTS) return results;
            }
        }
        return results;
    }, [
        searching, normalizedQuery, detectedGroups, channelsByCategory, unhiddenGroups,
        qualityOnlyGroups, qualityOnlyChannelsByCategory, overrides,
    ]);

    // Lista trocou de conteúdo (grupos ↔ busca) — o foco velho não faz mais
    // sentido no meio de outra lista. Ajuste durante o render (não em
    // effect, e com state — não ref, que não pode ser lido durante o
    // render): só reseta quando `searching` MUDA de verdade, nunca a cada
    // novo `rows` (alternar um item não pode fazer o foco pular).
    const [prevSearching, setPrevSearching] = useState(searching);
    if (prevSearching !== searching) {
        setPrevSearching(searching);
        setFocusedIndex(rows.length > 0 ? 0 : -1);
    }

    useEffect(() => {
        const focused = listRef.current?.querySelector('.hg-row.tv-focused');
        focused?.scrollIntoView({ block: 'nearest' });
    }, [focusedIndex]);

    const toggleGroup = (categoryId: string) => {
        setUnhiddenGroups(prev => {
            const next = new Set(prev);
            if (next.has(categoryId)) next.delete(categoryId); else next.add(categoryId);
            curatedHiddenPrefs.setUnhiddenGroups(next);
            return next;
        });
    };

    const toggleChannel = (streamId: number, categoryId: string, channelName: string) => {
        const defaultVisible = qualityOnlyCategoryIds.has(categoryId)
            ? isQualityTaggedChannel(channelName)
            : unhiddenGroups.has(categoryId);
        setOverrides(prev => {
            const next = toggleOverride(prev, streamId, defaultVisible);
            curatedHiddenPrefs.setChannelOverrides(next);
            return next;
        });
    };

    useTVNavigation({
        enabled: !editing,
        onNavigate: (direction) => {
            if (direction === 'up') {
                setFocusedIndex(prev => Math.max(-1, prev - 1));
            } else if (direction === 'down') {
                setFocusedIndex(prev => Math.min(rows.length - 1, prev + 1));
            }
        },
        onEnter: () => {
            if (focusedIndex === -1) {
                setEditing(true);
                inputRef.current?.focus();
                return;
            }
            const row = rows[focusedIndex];
            if (!row) return;
            if (row.kind === 'group') toggleGroup(row.categoryId);
            else toggleChannel(row.streamId, row.categoryId, row.name);
        },
        onBack: onClose,
    });

    return (
        <div className="hg-overlay">
            <div className="hg-panel">
                <div className="hg-header">
                    <h2 className="hg-title">Canais ocultos por padrão</h2>
                    <button className="hg-close" onClick={onClose}><FaTimes /></button>
                </div>

                <div className={`hg-search ${focusedIndex === -1 ? 'tv-focused' : ''}`}>
                    <FaSearch className="hg-search-icon" />
                    <input
                        ref={inputRef}
                        className="hg-search-input"
                        value={query}
                        placeholder="Buscar canal oculto (mín. 2 letras)…"
                        onChange={(e) => setQuery(e.target.value)}
                        onFocus={() => { setEditing(true); setFocusedIndex(-1); }}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape' || e.key === 'Enter') {
                                e.currentTarget.blur();
                                setEditing(false);
                            }
                        }}
                    />
                </div>

                <div ref={listRef} className="hg-list">
                    {catalog.length === 0 && (
                        <div className="hg-empty">
                            Nenhum catálogo carregado ainda — abra a TV ao Vivo pra
                            carregar a lista de canais.
                        </div>
                    )}
                    {catalog.length > 0 && detectedGroups.length === 0 && (
                        <div className="hg-empty">
                            Nenhuma categoria "ruído" detectada nesse provedor.
                        </div>
                    )}
                    {catalog.length > 0 && detectedGroups.length > 0 && rows.length === 0 && searching && (
                        <div className="hg-empty">Nenhum canal bate com essa busca.</div>
                    )}
                    {rows.map((row, index) => {
                        const isFocused = focusedIndex === index;
                        const key = row.kind === 'group' ? `g-${row.categoryId}` : `c-${row.streamId}`;
                        return (
                            <div
                                key={key}
                                className={`hg-row ${isFocused ? 'tv-focused' : ''}`}
                                onClick={() => row.kind === 'group' ? toggleGroup(row.categoryId) : toggleChannel(row.streamId, row.categoryId, row.name)}
                            >
                                {row.unhidden ? <FaCheckSquare className="hg-row-icon" /> : <FaRegSquare className="hg-row-icon" />}
                                {row.kind === 'group' ? (
                                    <span className="hg-row-label">{row.label} <span className="hg-row-count">({row.count})</span></span>
                                ) : (
                                    <span className="hg-row-label">{row.name}</span>
                                )}
                                <span className="hg-row-state">{row.unhidden ? 'Visível' : 'Oculto'}</span>
                            </div>
                        );
                    })}
                    {searching && rows.length === MAX_SEARCH_RESULTS && (
                        <div className="hg-more">+ resultados — refine a busca pra ver mais</div>
                    )}
                </div>

                <div className="hg-hints">
                    <span>↑↓ Navegar</span>
                    <span>OK alterna visível/oculto</span>
                    <span>← Fechar</span>
                </div>
            </div>
        </div>
    );
}
