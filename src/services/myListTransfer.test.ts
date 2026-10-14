import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeStorage } from '../testing/fakeStorage';
import { storage } from './storage';
import { listsService, MAX_LISTAS } from './listsService';
import {
    exportarMinhaLista, exportarMinhaListaQr, importarMinhaLista, FORMATO_MINHA_LISTA_QR,
} from './myListTransfer';

beforeEach(() => {
    installFakeStorage();
});

const filme = (id: string, title = `Filme ${id}`) => ({ id, type: 'movie' as const, title, poster: `http://img/${id}.jpg`, container: 'mp4' });

function montar() {
    storage.addWatchLater(filme('1'));
    storage.addWatchLater({ id: '1', type: 'series', title: 'Série 1' }); // mesmo id, outro tipo
    const sexta = listsService.create('Maratona de sexta')!;
    listsService.toggleItem(sexta.id, filme('1'));
    listsService.toggleItem(sexta.id, filme('2'));
}

const chaves = () => storage.getWatchLater().map(i => `${i.type}:${i.id}`).sort();
const daLista = (nome: string) => listsService.list().find(l => l.nome === nome)?.itens.map(i => i.id).sort();

describe('Minha Lista: exportar e importar', () => {
    it('arquivo: ida e volta num aparelho vazio, com capa, listas e id repetido entre filme e série', () => {
        montar();
        const json = exportarMinhaLista();
        installFakeStorage();
        // Filme 1 está na lista padrão E na nomeada: conta uma vez só
        expect(importarMinhaLista(json)).toEqual({ ok: true, novos: 3, listas: 1 });
        expect(chaves()).toEqual(['movie:1', 'series:1']);
        expect(storage.getWatchLater().find(i => i.type === 'movie')?.poster).toBe('http://img/1.jpg');
        expect(daLista('Maratona de sexta')).toEqual(['1', '2']);
    });

    it('QR: páginas dentro do teto, cada uma importa sozinha', () => {
        for (let i = 0; i < 40; i++) storage.addWatchLater(filme(String(i), `Um título bem comprido de filme número ${i}`));
        const sexta = listsService.create('Maratona de sexta')!;
        listsService.toggleItem(sexta.id, filme('7'));
        const paginas = exportarMinhaListaQr(500);
        expect(paginas.length).toBeGreaterThan(1);
        for (const p of paginas) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(500);
        installFakeStorage();
        for (const p of paginas) expect(importarMinhaLista(p).ok).toBe(true);
        expect(storage.getWatchLater()).toHaveLength(40);
        expect(daLista('Maratona de sexta')).toEqual(['7']);
    });

    it('junta, não substitui: repetido não duplica e lista casa pelo nome', () => {
        montar();
        const json = exportarMinhaLista();
        expect(importarMinhaLista(json)).toEqual({ ok: true, novos: 0, listas: 0 });
        expect(chaves()).toEqual(['movie:1', 'series:1']);
        expect(listsService.list()).toHaveLength(1);
    });

    it('item só numa lista nomeada não entra na lista padrão', () => {
        const json = JSON.stringify({ f: FORMATO_MINHA_LISTA_QR, i: [['9', 'movie', 'Só na lista', '', 0, ['Clássicos']]] });
        expect(importarMinhaLista(json)).toEqual({ ok: true, novos: 1, listas: 1 });
        expect(storage.getWatchLater()).toHaveLength(0);
        expect(daLista('Clássicos')).toEqual(['9']);
    });

    it('respeita o teto de listas', () => {
        for (let i = 0; i < MAX_LISTAS; i++) listsService.create(`L${i}`);
        const json = JSON.stringify({ f: FORMATO_MINHA_LISTA_QR, i: [['9', 'movie', 'X', '', 0, ['Nova demais']]] });
        expect(importarMinhaLista(json)).toEqual({ ok: true, novos: 0, listas: 0 });
    });

    it('recusa o que não é dela (inclusive o arquivo da lista secreta) e item sem tipo', () => {
        expect(importarMinhaLista('isso não é json').ok).toBe(false);
        expect(importarMinhaLista(JSON.stringify({ f: 'neostream-secret-1', itens: [] })).error).toBe('Formato desconhecido.');
        const json = JSON.stringify({ f: FORMATO_MINHA_LISTA_QR, i: [['1', 'adulto', 'X', '', 1, []], 'lixo'] });
        expect(importarMinhaLista(json)).toEqual({ ok: true, novos: 0, listas: 0 });
    });
});
