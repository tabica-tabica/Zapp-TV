// Bloqueio por PIN de categorias detectadas como adulto (item novo).
//
// O gatilho do auto-provisionamento do PIN "0000" NÃO é "categoria adulta
// existe na lista" — isso provisionaria um PIN de aparelho, silenciosamente,
// pra todo mundo cujo provedor Xtream inclui uma categoria "Adultos" (comum
// no Brasil), mesmo que a pessoa nunca abra aquela categoria. O gatilho é a
// PRIMEIRA TENTATIVA REAL de abrir uma categoria adulta.

import { useState, useMemo, useCallback } from 'react';
import { parentalService } from '../services/parentalService';
import { isAdultCategoryName } from '../services/kidsFilter';
import type { Category } from '../types';

export function useAdultLock(categories: Category[]) {
    const [unlocked, setUnlocked] = useState(false);
    const [pendingCategoryId, setPendingCategoryId] = useState<string | null>(null);
    const [justProvisioned, setJustProvisioned] = useState(false);

    // Flag pura do portão — não depende de isSet(), então o selo 🔒 aparece
    // mesmo ANTES de qualquer PIN existir (sinal visual honesto: "isso vai
    // pedir PIN"). Perfis Kids nunca veem a categoria adulta pra começo de
    // conversa (kidsFilter.apply() já a removeu antes de chegar aqui).
    const gateEnabled = parentalService.getGates().adultCategories;

    const lockedCategoryIds = useMemo(() => {
        if (!gateEnabled) return new Set<string>();
        const ids = new Set<string>();
        for (const category of categories) {
            if (isAdultCategoryName(category.category_name || '')) ids.add(category.category_id);
        }
        return ids;
    }, [categories, gateEnabled]);

    const guardSelect = useCallback((categoryId: string, proceed: () => void) => {
        if (unlocked || !lockedCategoryIds.has(categoryId)) {
            proceed();
            return;
        }
        if (!parentalService.isSet()) {
            // Espera o provisionamento terminar (hash SHA-256 é assíncrono) antes
            // de abrir o prompt — senão dá pra digitar "0000" antes do PIN
            // realmente ter sido gravado, e o verify() nega por engano.
            parentalService.autoProvisionAdultLock().then(() => {
                setJustProvisioned(true);
                setPendingCategoryId(categoryId);
            });
            return;
        }
        setPendingCategoryId(categoryId);
    }, [unlocked, lockedCategoryIds]);

    return {
        lockedCategoryIds,
        guardSelect,
        pendingCategoryId,
        setPendingCategoryId,
        unlocked,
        setUnlocked,
        justProvisioned,
    };
}
