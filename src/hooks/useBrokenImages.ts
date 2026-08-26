// Padrão repetido em LiveTV/Movies/Series: um Set de ids cujo <img> falhou,
// pra trocar por um placeholder em vez de deixar o ícone quebrado do
// navegador. Antes copiado (useState<Set> + handler) em cada página.

import { useCallback, useState } from 'react';

export function useBrokenImages<T = number>() {
    const [broken, setBroken] = useState<Set<T>>(() => new Set());

    const markBroken = useCallback((id: T) => {
        setBroken(prev => {
            if (prev.has(id)) return prev;
            return new Set(prev).add(id);
        });
    }, []);

    const isBroken = useCallback((id: T) => broken.has(id), [broken]);

    return { isBroken, markBroken };
}
