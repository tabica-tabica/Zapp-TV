// Agrupador de variantes de qualidade — cobertura nova: até aqui, o arquivo
// nunca teve teste. O caso mais importante aqui é o formato de nome que o
// tools/m3u-transformer gera ("Raiz (Áudio - Qualidade)"), que o regex
// original não reconhecia e não agrupava.

import { describe, it, expect } from 'vitest';
import {
    variantBaseName, channelDisplayName, groupChannelVariants, isSubtitledVariant, qualityLabel, mirrorTag,
} from './channelVariants';

describe('variantBaseName', () => {
    it('parêntese só com a tag vira a raiz', () => {
        expect(variantBaseName('ESPN (FHD)')).toBe('espn');
    });

    it('sufixo solto sem parênteses vira a raiz', () => {
        expect(variantBaseName('ESPN FHD')).toBe('espn');
    });

    it('qualidade + codec soltos no fim (ex.: provedor real) agrupam pela mesma raiz', () => {
        expect(variantBaseName('Canal Brasil FHD H265')).toBe(variantBaseName('Canal Brasil'));
        expect(variantBaseName('RedeTV! FHD H265')).toBe(variantBaseName('RedeTV!'));
    });

    it('codec sozinho (sem tag de qualidade por perto) também agrupa — provedor real usa H265 como rótulo de qualidade', () => {
        expect(variantBaseName('ESPN 2 H265')).toBe(variantBaseName('ESPN 2'));
        expect(variantBaseName('ESPN 2 H265')).toBe(variantBaseName('ESPN 2 FHD'));
        expect(variantBaseName('Discovery Theater H265')).toBe(variantBaseName('Discovery Theater FHD'));
    });

    it('parêntese composto do m3u-transformer ("Raiz (Áudio - Qualidade)") agrupa pela raiz', () => {
        expect(variantBaseName('GloboNews (Não especificado - FHD)')).toBe('globonews');
        expect(variantBaseName('GloboNews (Não especificado - HD)')).toBe('globonews');
    });

    it('parêntese sem tag de qualidade não é tocado', () => {
        expect(variantBaseName('Rede TV (SP)')).toBe('rede tv (sp)');
    });

    it('nome sem nenhuma tag fica igual (só minúsculo)', () => {
        expect(variantBaseName('Discovery Channel')).toBe('discovery channel');
    });

    // Achado real: "Canais | Legendados" nomeia tudo "<Nome> <FHD|HD> [L]" —
    // a mesma raiz do canal dublado ("Canais | HBO" tem "HBO"/"HBO FHD"/"HBO
    // HD"), então precisa cair no MESMO grupo pra virar 1 card com opção de
    // legenda, não um card duplicado à parte.
    it('"[L]" (Legendado) agrupa na MESMA raiz do canal dublado', () => {
        expect(variantBaseName('HBO FHD [L]')).toBe('hbo');
        expect(variantBaseName('HBO HD [L]')).toBe(variantBaseName('HBO'));
        expect(variantBaseName('TNT Séries FHD [L]')).toBe(variantBaseName('TNT Séries HD'));
    });

    // Achado real: "Canais | Paramount+" (e Disney+/MAX/Prime Video/DAZN/NBA
    // League Pass/times de futebol) nomeiam cada NÚMERO como "<Nome> <N> (A)"
    // / "<Nome> <N> <FHD|HD|SD> (B)" — servidor espelhado, mesmo conteúdo em
    // 2 links. Sem agrupar isso, 17 entradas de Paramount+ viravam 17 cards
    // soltos em vez de 5 (um por número).
    it('"(A)"/"(B)" (servidor espelhado) agrupa na MESMA raiz', () => {
        expect(variantBaseName('Paramount+ 1 (A)')).toBe('paramount+ 1');
        expect(variantBaseName('Paramount+ 1 FHD (B)')).toBe(variantBaseName('Paramount+ 1 (A)'));
        expect(variantBaseName('Paramount+ 1 HD (B)')).toBe(variantBaseName('Paramount+ 1 (A)'));
        expect(variantBaseName('Paramount+ 1 SD (B)')).toBe(variantBaseName('Paramount+ 1 (A)'));
    });

    it('"(A)"/"(B)" não junta números DIFERENTES do mesmo serviço', () => {
        expect(variantBaseName('Paramount+ 1 (A)')).not.toBe(variantBaseName('Paramount+ 2 (A)'));
        expect(variantBaseName('Canal Goat 01 (A)')).not.toBe(variantBaseName('Canal Goat 02 (A)'));
    });

    // Achado real: "Canais | Disney+" tem os DOIS espelhos com o número em
    // posição DIFERENTE — servidor A: "Disney+ HD 2" (tag antes do número);
    // servidor B: "Disney+ 2 HD"/"Disney+ 2" (número antes da tag). Sem
    // normalizar a ordem, os dois espelhos do MESMO canal nunca batiam a
    // mesma raiz e ficavam em cards separados.
    it('"<Marca> HD <N>" (tag antes do número) agrupa com "<Marca> <N> HD" (número antes da tag)', () => {
        expect(variantBaseName('Disney+ HD 2 (A)')).toBe(variantBaseName('Disney+ 2 HD (B)'));
        expect(variantBaseName('Disney+ HD 3 (A)')).toBe(variantBaseName('Disney+ 3 (B)'));
        expect(variantBaseName('Disney+ HD 2 (A)')).toBe('disney+ 2');
    });

    it('"HD" sozinho no fim (sem número) continua tratado como tag comum, não mexe', () => {
        expect(variantBaseName('Discovery Theater HD')).toBe('discovery theater');
    });

    // Achado real: "Canais | TNT" tinha "TNT Séries FHD" (com acento) e "TNT
    // Series H265" (sem acento) — mesmo canal, grafia diferente entre
    // variantes do MESMO provedor. Sem tirar o acento da chave, "séries" ≠
    // "series" e os 6 variantes (incluindo as legendadas) nunca batiam a
    // mesma raiz.
    it('acento na chave não separa variantes do mesmo canal ("Séries" == "Series")', () => {
        expect(variantBaseName('TNT Séries FHD')).toBe(variantBaseName('TNT Series H265'));
        expect(variantBaseName('TNT Series H265')).toBe('tnt series');
        expect(variantBaseName('SBT Piauí')).toBe(variantBaseName('SBT Piaui HD'));
    });

    it('channelDisplayName preserva o acento original (só a CHAVE de agrupamento tira)', () => {
        expect(channelDisplayName('TNT Séries FHD')).toBe('TNT Séries');
    });
});

describe('mirrorTag', () => {
    it('detecta "(A)"/"(B)" solto entre parênteses ou colchetes', () => {
        expect(mirrorTag('Paramount+ 1 (A)')).toBe('A');
        expect(mirrorTag('Paramount+ 1 FHD (B)')).toBe('B');
        expect(mirrorTag('DAZN 3 [a]')).toBe('A');
    });

    it('null quando não tem o marcador', () => {
        expect(mirrorTag('HBO FHD')).toBeNull();
    });

    it('não confunde com o marcador de Legendado "[L]"', () => {
        expect(mirrorTag('HBO FHD [L]')).toBeNull();
    });
});

describe('isSubtitledVariant', () => {
    it('detecta o marcador "[L]"', () => {
        expect(isSubtitledVariant('HBO FHD [L]')).toBe(true);
        expect(isSubtitledVariant('HBO FHD')).toBe(false);
    });

    it('detecta a palavra solta "legendado"/"legendada"', () => {
        expect(isSubtitledVariant('Globo Legendada')).toBe(true);
        expect(isSubtitledVariant('Canal Legendado')).toBe(true);
    });

    it('não confunde "L" dentro de outra palavra com o marcador', () => {
        expect(isSubtitledVariant('Land Channel')).toBe(false);
    });
});

describe('qualityLabel com legendado', () => {
    it('acrescenta "Legendado" no rótulo quando a variante é legendada', () => {
        expect(qualityLabel('HBO FHD [L]')).toBe('FHD Legendado');
        expect(qualityLabel('HBO HD [L]')).toBe('HD Legendado');
    });

    it('rótulo normal (sem "Legendado") pra variante dublada', () => {
        expect(qualityLabel('HBO FHD')).toBe('FHD');
    });

    it('acrescenta o servidor espelhado quando há tag de qualidade E marcador (A)/(B)', () => {
        expect(qualityLabel('Paramount+ 1 FHD (B)')).toBe('FHD · B');
        expect(qualityLabel('Paramount+ 1 HD (B)')).toBe('HD · B');
    });

    it('sem tag de qualidade nenhuma, o servidor espelhado vira o próprio rótulo', () => {
        expect(qualityLabel('Paramount+ 1 (A)')).toBe('Servidor A');
    });
});

describe('channelDisplayName', () => {
    it('mesmas regras de variantBaseName, mas preserva a caixa original', () => {
        expect(channelDisplayName('ESPN (FHD)')).toBe('ESPN');
        expect(channelDisplayName('ESPN FHD')).toBe('ESPN');
        expect(channelDisplayName('GloboNews (Não especificado - FHD)')).toBe('GloboNews');
        expect(channelDisplayName('Rede TV (SP)')).toBe('Rede TV (SP)');
    });

    it('nome que é só a tag não vira string vazia', () => {
        expect(channelDisplayName('FHD')).toBe('FHD');
    });
});

describe('groupChannelVariants', () => {
    it('nomes compostos do m3u-transformer agrupam num representante com 2+ variantes', () => {
        const channels = [
            { stream_id: 1, name: 'GloboNews (Não especificado - HD)' },
            { stream_id: 2, name: 'GloboNews (Não especificado - FHD)' },
            { stream_id: 3, name: 'ESPN (Não especificado - SD)' },
        ];
        const { groups, variantsOf } = groupChannelVariants(channels);

        // Representante do grupo GloboNews é a melhor qualidade (FHD).
        expect(groups.map(c => c.stream_id)).toEqual([2, 3]);
        const globoNewsVariants = variantsOf.get('2');
        expect(globoNewsVariants?.map(c => c.stream_id)).toEqual([2, 1]);
        // ESPN sozinho não entra em variantsOf.
        expect(variantsOf.has('3')).toBe(false);
    });

    it('representante usa o stream_id/nome da melhor qualidade, mas o logo da variante de PIOR qualidade do grupo', () => {
        const channels = [
            { stream_id: 10, name: 'Canal Brasil FHD H265', stream_icon: 'http://x/quebrado.png' },
            { stream_id: 11, name: 'Canal Brasil', stream_icon: 'http://x/bom.png' }, // sem tag = pior rank do grupo
        ];
        const { groups, variantsOf } = groupChannelVariants(channels);

        expect(groups).toHaveLength(1);
        expect(groups[0].stream_id).toBe(10); // FHD continua sendo quem toca por padrão
        expect(groups[0].stream_icon).toBe('http://x/bom.png'); // mas o logo vem da variante confiável
        expect(variantsOf.get('10')?.map(c => c.stream_id)).toEqual([10, 11]);
    });

    it('com 3+ qualidades, o logo vem da pior do grupo (SD), não de uma intermediária', () => {
        const channels = [
            { stream_id: 20, name: 'ESPN FHD', stream_icon: 'http://x/fhd.png' },
            { stream_id: 21, name: 'ESPN HD', stream_icon: 'http://x/hd.png' },
            { stream_id: 22, name: 'ESPN SD', stream_icon: 'http://x/sd.png' },
        ];
        const { groups } = groupChannelVariants(channels);
        expect(groups[0].stream_id).toBe(20); // FHD continua tocando por padrão
        expect(groups[0].stream_icon).toBe('http://x/sd.png');
    });

    it('canal sozinho (sem variante) passa direto, com o próprio logo', () => {
        const channels = [
            { stream_id: 30, name: 'Canal X SD', stream_icon: 'http://x/unica.png' },
        ];
        const { groups } = groupChannelVariants(channels);
        expect(groups[0].stream_icon).toBe('http://x/unica.png');
    });

    // Pedido: "Legendados" vira uma OPÇÃO dentro do grupo do canal dublado,
    // não o padrão — mesmo com qualidade EMPATADA (FHD dublado vs FHD
    // legendado), quem tem que continuar tocando ao clicar o card é o
    // dublado. O legendado só aparece nos botões de qualidade do menu.
    it('"[L]" nunca vira representante quando existe irmão dublado de qualidade igual ou melhor', () => {
        const channels = [
            { stream_id: 1, name: 'HBO' },
            { stream_id: 2, name: 'HBO FHD' },
            { stream_id: 3, name: 'HBO HD' },
            { stream_id: 4, name: 'HBO FHD [L]' },
            { stream_id: 5, name: 'HBO HD [L]' },
        ];
        const { groups, variantsOf } = groupChannelVariants(channels);
        expect(groups).toHaveLength(1);
        expect(groups[0].stream_id).toBe(2); // HBO FHD (dublado) continua tocando por padrão
        // todas as 5 variantes ficam no MESMO grupo, dublado antes de legendado
        expect(variantsOf.get('2')?.map(c => c.stream_id)).toEqual([2, 3, 1, 4, 5]);
    });

    it('sem NENHUM irmão dublado, o legendado de melhor qualidade vira representante', () => {
        const channels = [
            { stream_id: 1, name: 'Sony FHD [L]' },
            { stream_id: 2, name: 'Sony HD [L]' },
        ];
        const { groups } = groupChannelVariants(channels);
        expect(groups[0].stream_id).toBe(1); // só sobrou legendado — o de melhor qualidade toca
    });

    // Achado real: "Canais | Paramount+" tinha 17 canais soltos (4-5 por
    // número), nenhum agrupado — "organizar" significa virar 1 card por
    // número, com (A)/FHD(B)/HD(B)/SD(B) como opções dentro dele.
    it('"Paramount+ 1 (A)"/"FHD (B)"/"HD (B)"/"SD (B)" viram 1 card só, com a melhor qualidade tocando', () => {
        const channels = [
            { stream_id: 101, name: 'Paramount+ 1 (A)' },
            { stream_id: 102, name: 'Paramount+ 1 FHD (B)' },
            { stream_id: 103, name: 'Paramount+ 1 HD (B)' },
            { stream_id: 104, name: 'Paramount+ 1 SD (B)' },
            { stream_id: 201, name: 'Paramount+ 2 (A)' },
        ];
        const { groups, variantsOf } = groupChannelVariants(channels);
        expect(groups).toHaveLength(2); // 1 por número, não 5 cards soltos
        expect(groups[0].stream_id).toBe(102); // FHD (B) é a melhor qualidade do grupo 1
        expect(variantsOf.get('102')?.map(c => c.stream_id)).toEqual([102, 103, 101, 104]);
        // Paramount+ 2 tem só 1 variante — passa direto, sem entrar em variantsOf.
        expect(groups[1].stream_id).toBe(201);
        expect(variantsOf.has('201')).toBe(false);
    });

    it('"Disney+ HD 2 (A)" e "Disney+ 2 HD (B)" (mesmo canal, ordem de palavra diferente) viram 1 card só', () => {
        const channels = [
            { stream_id: 1, name: 'Disney+ 2 HD (B)' },
            { stream_id: 2, name: 'Disney+ HD 2 (A)' },
            { stream_id: 3, name: 'Disney+ 3 (B)' },
            { stream_id: 4, name: 'Disney+ HD 3 (A)' },
        ];
        const { groups, variantsOf } = groupChannelVariants(channels);
        expect(groups).toHaveLength(2); // 1 card por número, não 4 soltos
        expect(variantsOf.get(String(groups[0].stream_id))?.map(c => c.stream_id).sort()).toEqual([1, 2]);
        expect(variantsOf.get(String(groups[1].stream_id))?.map(c => c.stream_id).sort()).toEqual([3, 4]);
    });

    // Achado real: "Canais | TNT" tinha "TNT Séries FHD"/"HD" (com acento) e
    // "TNT Series H265" (sem acento) — mesmo canal, 4 cards soltos em vez de
    // 1, porque a chave de agrupamento não tirava o acento.
    it('"TNT Séries FHD"/"HD" e "TNT Series H265" (grafia com/sem acento) viram 1 card só', () => {
        const channels = [
            { stream_id: 1, name: 'TNT Séries FHD' },
            { stream_id: 2, name: 'TNT Séries HD' },
            { stream_id: 3, name: 'TNT Series H265' },
        ];
        const { groups, variantsOf } = groupChannelVariants(channels);
        expect(groups).toHaveLength(1);
        expect(groups[0].stream_id).toBe(1); // FHD é a melhor qualidade
        expect(variantsOf.get('1')?.map(c => c.stream_id).sort()).toEqual([1, 2, 3]);
    });
});
