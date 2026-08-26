// Flags "Incluir canais de TV" / "Incluir VOD" escolhidas no Login — decidem
// se a playlist ativa deve buscar/mostrar aquele tipo de conteúdo em QUALQUER
// lugar do app (não só esconder o botão da sidebar). Fonte única de leitura;
// quem grava continua sendo Login.tsx (na hora do login) e
// playlistService.setActive (ao trocar de playlist) — ver storageKeys.ts.

export const contentFlags = {
    includeTV(): boolean {
        return localStorage.getItem('includeTV') !== 'false';
    },
    includeVOD(): boolean {
        return localStorage.getItem('includeVOD') !== 'false';
    },
};
