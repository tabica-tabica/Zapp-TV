import { describe, it, expect } from 'vitest';
import { detectRegionalFamilies, detectCategoryFamilies } from './regionalVariants';

describe('detectRegionalFamilies', () => {
    it('agrupa afiliadas regionais que compartilham todas as palavras menos a última', () => {
        const channels = [
            { stream_id: 1, name: 'RedeTV!' },
            { stream_id: 2, name: 'RedeTV! Guará' },
            { stream_id: 3, name: 'RedeTV! Imperial' },
            { stream_id: 4, name: 'RedeTV! Paraná' },
            { stream_id: 5, name: 'Canal Brasil' },
        ];
        const families = detectRegionalFamilies(channels);
        expect(families.size).toBe(1);
        const [members] = [...families.values()];
        expect(members.map(c => c.stream_id).sort()).toEqual([1, 2, 3, 4]);
    });

    // RECALIBRADO: exigir o canal-mãe de verdade é o que distingue afiliada
    // regional legítima de "marca + gênero" coincidente — ver o comentário no
    // topo de regionalVariants.ts (achado num catálogo real de ~3 mil canais:
    // "Urban Sports"/"Urban Movies"/"Urban Kids" não são afiliadas de "Urban",
    // são canais diferentes que só coincidem no primeiro nome).
    it('SEM a variante "nua" presente, não forma família (evita "marca + gênero" falso-positivo)', () => {
        const channels = [
            { stream_id: 2, name: 'RedeTV! Guará' },
            { stream_id: 3, name: 'RedeTV! Imperial' },
        ];
        expect(detectRegionalFamilies(channels).size).toBe(0);
    });

    it('marca + gênero (sem canal-mãe) NÃO forma família — "Urban Sports"/"Urban Movies" são canais diferentes', () => {
        const channels = [
            { stream_id: 1, name: 'Urban Sports' },
            { stream_id: 2, name: 'Urban Movies' },
            { stream_id: 3, name: 'Urban Kids' },
        ];
        expect(detectRegionalFamilies(channels).size).toBe(0);
    });

    it('não confunde canal numerado ("ESPN 2") com afiliada de "ESPN"', () => {
        const channels = [
            { stream_id: 1, name: 'ESPN' },
            { stream_id: 2, name: 'ESPN 2' },
            { stream_id: 3, name: 'ESPN III' },
        ];
        const families = detectRegionalFamilies(channels);
        expect(families.size).toBe(0);
    });

    it('não confunde servidor espelhado ("DAZN 3 (A)"/"(B)") com afiliada regional', () => {
        const channels = [
            { stream_id: 1, name: 'DAZN 3 (A)' },
            { stream_id: 2, name: 'DAZN 3 (B)' },
            { stream_id: 3, name: 'SportyNet 01 (A)' },
            { stream_id: 4, name: 'SportyNet 01 (B)' },
        ];
        expect(detectRegionalFamilies(channels).size).toBe(0);
    });

    it('canal sozinho, sem par, não forma família', () => {
        const channels = [
            { stream_id: 1, name: 'Discovery Channel' },
            { stream_id: 2, name: 'History Channel' },
        ];
        expect(detectRegionalFamilies(channels).size).toBe(0);
    });

    // Achado real: mesmo com o canal-mãe "Woohoo" existindo de verdade, ele
    // e "Woohoo Esportes" são DOIS CANAIS DIFERENTES, não praças regionais —
    // "Esportes" é gênero, não cidade. A lista de palavras de gênero cobre
    // esse caso mesmo quando o canal-mãe coincidentemente existe.
    it('"Woohoo" + "Woohoo Esportes" NÃO merge — "Esportes" é gênero, não praça', () => {
        const channels = [
            { stream_id: 1, name: 'Woohoo' },
            { stream_id: 2, name: 'Woohoo Esportes' },
        ];
        expect(detectRegionalFamilies(channels).size).toBe(0);
    });

    // Visto na TV (14/10/2026): o dedup tirava o Nick Jr. da grade e do perfil Kids
    it('"Nick" + "Nick Jr." + "Nick Jr. Club" NÃO merge — público, não praça', () => {
        const channels = [
            { stream_id: 1, name: 'Nick HD' },
            { stream_id: 2, name: 'Nick Jr. HD' },
            { stream_id: 3, name: 'Nick Jr. Club' },
        ];
        expect(detectRegionalFamilies(channels).size).toBe(0);
    });

    // Achado real: "RecordTV" tem dezenas de praças (RecordTV Bahia, RecordTV
    // Recife...), e ALGUMAS delas têm sub-praças (RecordTV Bahia Itabuna).
    // Sem achatar, "RecordTV Bahia" virava o canal-mãe de uma família SEPARADA
    // ("RecordTV" e "RecordTV Bahia" apareciam como duas telas de escolha
    // diferentes em vez de uma só).
    it('famílias aninhadas (RecordTV → RecordTV Bahia → RecordTV Bahia Itabuna) achatam numa família só', () => {
        const channels = [
            { stream_id: 1, name: 'RecordTV' },
            { stream_id: 2, name: 'RecordTV Bahia' },
            { stream_id: 3, name: 'RecordTV Bahia Itabuna' },
            { stream_id: 4, name: 'RecordTV Recife' },
            { stream_id: 5, name: 'RecordTV Recife Guararapes' },
        ];
        const families = detectRegionalFamilies(channels);
        expect(families.size).toBe(1);
        const [members] = [...families.values()];
        expect(members.map(c => c.stream_id).sort()).toEqual([1, 2, 3, 4, 5]);
    });
});

describe('detectCategoryFamilies', () => {
    // Achado real: em "Canais | Globo" nenhum canal se chama só "Globo" — só
    // praças ("Globo SP", "EPTV Campinas", "RBS TV Porto Alegre"...), e boa
    // parte tem 2+ palavras extras (cidade + estado). detectRegionalFamilies
    // (heurística de NOME) não forma família nenhuma nesse caso; é por isso
    // que essa função existe: a categoria INTEIRA já é a rede.
    const categories = [
        { category_id: '10', category_name: 'Canais | Globo' },
        { category_id: '11', category_name: 'Canais | SBT' },
        { category_id: '20', category_name: 'Canais | Esportes' },
    ];

    it('agrupa toda a categoria de rede como 1 família, mesmo sem nome em comum', () => {
        const channels = [
            { stream_id: 1, name: 'Globo SP', category_id: '10' },
            { stream_id: 2, name: 'EPTV Campinas', category_id: '10' },
            { stream_id: 3, name: 'RBS TV Porto Alegre', category_id: '10' },
        ];
        const families = detectCategoryFamilies(channels, categories);
        expect(families.size).toBe(1);
        const [members] = [...families.values()];
        expect(members.map(c => c.stream_id).sort()).toEqual([1, 2, 3]);
    });

    it('duas categorias de rede diferentes viram duas famílias separadas', () => {
        const channels = [
            { stream_id: 1, name: 'Globo SP', category_id: '10' },
            { stream_id: 2, name: 'Globo RJ', category_id: '10' },
            { stream_id: 3, name: 'SBT São Paulo', category_id: '11' },
            { stream_id: 4, name: 'SBT Rio', category_id: '11' },
        ];
        const families = detectCategoryFamilies(channels, categories);
        expect(families.size).toBe(2);
    });

    it('categoria que não bate em nenhum padrão de rede não forma família', () => {
        const channels = [
            { stream_id: 1, name: 'ESPN', category_id: '20' },
            { stream_id: 2, name: 'Fox Sports', category_id: '20' },
        ];
        expect(detectCategoryFamilies(channels, categories).size).toBe(0);
    });

    it('categoria de rede com só 1 canal não forma família (nada pra escolher)', () => {
        const channels = [{ stream_id: 1, name: 'Globo SP', category_id: '10' }];
        expect(detectCategoryFamilies(channels, categories).size).toBe(0);
    });

    it('ignora maiúsculas/minúsculas e acento no nome da categoria', () => {
        const upperCategories = [{ category_id: '10', category_name: 'CANAIS | GLOBO' }];
        const channels = [
            { stream_id: 1, name: 'Globo SP', category_id: '10' },
            { stream_id: 2, name: 'Globo RJ', category_id: '10' },
        ];
        expect(detectCategoryFamilies(channels, upperCategories).size).toBe(1);
    });
});
