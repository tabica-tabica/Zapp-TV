# webOS: armadilhas, desempenho e pendências

Notas de uma sessão inteira testando numa LG de verdade (webOS 4.x,
**Chromium 53**, ~1 GB de RAM, conta do painel com **1 conexão**). Cada item
abaixo foi visto no aparelho, não deduzido. Antes de mexer em player, prévia,
grade ou CSS de TV, leia a seção 1.

## 1. Armadilhas do webOS 4 (Chromium 53)

| Sintoma na TV | Causa | Onde ficou a correção |
| --- | --- | --- |
| Voltar do controle não fazia nada | O webOS manda `key: "RCUBack"` + `keyCode: 461`; o `matchKey` só olhava o `key` | `src/hooks/useTVNavigation.ts` (`matchKey` confere key **e** keyCode) |
| Grade da TV ao Vivo lenta (0,4–2,2 s por seta) e cards sumindo ao rolar | (a) `height: 100%` não resolve contra altura vinda de flex → a grade crescia até o conteúdo e montava todos os cards; (b) `Element.scrollTo` não existe (Chrome 61) e o react-window pula a rolagem em silêncio; (c) react-window 2 cria `style` novo por célula e furava o `memo` | `src/pages/LiveTV.css`, `src/legacyPolyfills.ts`, `src/pages/ChannelCard.tsx` |
| Prévia (Home/TV ao Vivo) só com áudio, caixa preta | O vídeo sai num plano de hardware **por baixo** da página; `border-radius` + `overflow: hidden` em volta do `<video>` tira ele desse plano | `src/theme.css` (canto reto em `html.tv-lite`) |
| Stream morria ao trocar Home ⇄ TV ao Vivo ⇄ player | `<video>` que sai do documento perde o pipeline de mídia (volta com `readyState 0` e não sai mais) — mover pausa no spec, mas aqui reseta | `src/hooks/useHls.ts`: ao assumir um `<video>` movido, `hls.recoverMediaError()` no **mesmo** hls (mesma sessão/conexão) |
| Player abria com erro depois de prévia → player (CNN Internacional, 2ª ida) | O `<video>` movido leva 6–16 s pra voltar; o watchdog desistia aos 10 s, marcava falha no canal e reconectava com sessão NOVA (403 na conta de 1 conexão) | `src/components/VideoPlayer/VideoPlayer.tsx`: pipeline assumido ganha +10 s (`LIVE_ADOPT_GRACE_MS`) e o 1º remédio é `recoverMediaError` na mesma sessão |
| `enableWorker: true` não fazia nada; transmux na thread principal | O build ESM do hls.js (o que o Vite empacota) só cria worker com `workerPath` | `src/hooks/useHls.ts` (`workerPath` = `hls.js/dist/hls.worker.js?url`) |
| Medição pelo inspetor mentia | Sem `awaitPromise` no Chromium 53; e polling pelo DevTools atrasa quando a TV está ocupada | `scripts/tv-perf.mjs` mede **dentro** da página |
| Lint não pegava API que falta no webOS | O `browserslist` do projeto é `chrome >= 69` (Tizen) | `npm run lint:webos` (Chrome 53 + polyfills do webOS) |

| Assistir/Voltar na TV ao Vivo com 5–16 s de "carregando" | Mover o `<video>` da prévia pro player derrubava o pipeline e o `recoverMediaError` rebaixava os últimos segmentos | `<video>` **no lugar** (`LivePipeline.noLugar`): a ficha fica montada, escondida e congelada sob o player; o player só põe o vídeo em tela cheia por CSS e devolve com `retomar` (useHls). Ficha sem `z-index` nesse modo — o contexto de empilhamento dela prendia o vídeo sob a sidebar |

Regras que saem disso:

- **Não mover `<video>` tocando entre lugares do DOM sem o `recoverMediaError`** no webOS.
  Melhor ainda: não mover — redimensionar no lugar (fixed + z-index) mantém
  o pipeline sem engasgo. A prévia mora na camada única
  (`src/services/camadaVideo.ts`, fora da árvore do React, por cima do slot
  da página): Home ⇄ TV ao Vivo ⇄ player usam o MESMO `<video>` sem mover.
  O quadro da camada é contexto de empilhamento (z 15): o player em tela
  cheia sobe o quadro junto (`elevarQuadro`), senão a sidebar fica por cima.
- **Nada de recorte arredondado em volta de `<video>`** nos builds de TV.
- **Sort estável não é garantido** antes do Chrome 70 — por isso `es.array.sort` está na lista de polyfills.
- **Conta de 1 conexão**: o painel segue contando a conexão fechada por 6–16 s (medido trocando de canal, 12/10/2026; antes se estimava ~20 s) e recusa a nova com **500** (às vezes 403) — o app mostra "Aguardando o provedor liberar a conexão…" e tenta a cada ~3 s. Fechar e reabrir o app em sequência (ou testar com `curl` enquanto a TV toca) derruba a prévia por "limite" — não é bug do app.
- **Sessão do painel**: `.m3u8` **sem** `?token=` abre sessão nova (= conexão); as recargas da sessão aberta vão com token. Segmentos de 10 s. As capas dos canais vêm de um host de imagens que responde 429 em rajada.
- **`<video>` no webOS**: ao refazer o MediaSource dispara `error` com `video.error` **null** (não é erro — o player ignora); o seek inicial ao vivo só termina com 2–3 segmentos no buffer (~2 s); um ancestral com `z-index` + `position` cria contexto de empilhamento e prende um `<video>` `position: fixed` por baixo do resto da página.
- Foto da tela por SSAP (`executeOneShot`) **inclui** o plano de vídeo: preto na foto é preto na TV.

## 2. Decisões de desempenho (e por quê)

| Decisão | Efeito medido / esperado |
| --- | --- |
| hls.js **light** nos builds de TV (`vite.define.ts` → `hlsLightNaTV`) | `index.js` 1138 → 959 KB. Fica de fora: faixas alternativas de áudio/legenda **dentro de HLS**, DRM, CMCD, steering. Filme/série são mp4/mkv diretos (faixas do próprio `<video>`); canal ao vivo vem com 1 faixa. Desktop segue com o build completo. |
| Polyfills em **lista explícita** (`scripts/tizen-polyfills.mjs`) | `polyfills.js` 123 → 24 KB. `modernPolyfills: true` adivinhava pelo nome do método (91 módulos, inclusive um `URL` inteiro em JS no lugar do nativo). Acrescentar polyfill: rode `npm run lint:webos` e confira no `polyfills.js`. |
| Worker do hls.js (`workerPath`) | Transmux sai da thread principal (no perfil: ~1,7 s a cada 9 s navegando). Se o worker falhar, o hls.js volta pro inline sem erro fatal. |
| Prévia com buffer de 20 s (`useHls({ preview: true })`) | Antes: 30–60 s de 1080p (~5 MB/segmento) na RAM por uma caixa de 300 px; 8 s (menos que 1 segmento de 10 s) secava entre segmentos. 20 s: processo 124 → ~158 MB, ~150 MB livres na TV. O player que assume o pipeline devolve o buffer normal (30 s: ~135–167 MB). |
| Catálogo parseado 1× por sessão (`src/services/catalogCache.ts`) | A TV ao Vivo relia ~0,5 MB de JSON 3× por visita. |
| `transition: none` em `html.tv-lite` | Eram 68 `transition: all`; cada seta repintava 2 cards com sombra de 40 px por ~0,3 s. Loops já paravam (CPU parada 23 % → 3 %). |
| Escolha de variante (`ultimoCanalNoAr` em `src/services/liveHealth.ts`) | Prévia que sobe conta "ok"; a variante que caiu na **última** tentativa perde do empate; Home, TV ao Vivo e o stream estacionado usam a mesma. |

## 3. Bancada na TV (`npm run perf:tv`)

```bash
npm run perf:tv -- <ip-da-tv> --runs 3                 # compara com o baseline
npm run perf:tv -- <ip-da-tv> --runs 3 --save-baseline # grava novo baseline
npm run perf:tv -- <ip-da-tv> --only grade,troca       # cenários: home, grade, troca, assistir, zap, ocioso
npm run perf:tv -- <ip-da-tv> --ipk dist/ipk/x.ipk     # instala antes (Key Server ligado)
```

Pré-requisitos: app instalado em modo dev e **logado**; na 1ª vez, aceitar o
pareamento "Zapp perf" na TV. Estado (chave de pareamento, fotos, resultados,
baseline) fica em `.tv-perf/` (fora do git). A checagem de "prévia com imagem"
usa `python3` + Pillow (preta ≈ 0,2 de desvio, com imagem ≈ 34).

**Ninguém pode estar usando a TV durante a medição** — a bancada aperta
teclas, troca de página e reabre o app.

Baseline atual: 12/10/2026, 3 rodadas, mediana, **depois** do lote (worker,
buffer da prévia, cache de catálogo, hls light, polyfills e transições). O
anterior ficou em `.tv-perf/baseline-antes-lote.json`.

| Métrica | Antes do lote | Depois |
| --- | --- | --- |
| Prévia da Home / TV ao Vivo até tocar | 7,3 s / 10,8 s | 7,0 s / 7,1 s |
| Grade: tecla→quadro, mediana / p90 | 329 / 825 ms | 194 / 755 ms |
| Grade: teclas atendidas / foco visível | 89 % / 76 % | 100 % / 100 % |
| Mesmo `<video>` em todas as trocas | sim (1 sessão de playlist) | sim |
| Volta a tocar após troca (TV ao Vivo / player / voltar / Home) | 11,4 / 7,3 / 6,5 / 16,3 s | 10,6 / 7,0 / 6,2 / 8,9 s |
| CPU parada na TV ao Vivo com prévia | 30 % | 15 % |
| Heap JS | 22 MB | 20 MB |

O quadro chega no plano de vídeo **1,5–5 s depois** de o `<video>` já estar
andando (decodificando, `readyState 4`) — no build antigo também, e pior. A
checagem de imagem da bancada tenta por ~8 s; uma foto só dava "preta" à toa.

Referência anterior (v1.2.0, script avulso): grade 1033 ms de mediana e foco
fora da tela em 1/3 das setas.

### Medições avulsas (o que a bancada não cobre)

Troca de canal, prévia → player, sessão por requisição: dirigir pelo inspetor
(porta 9998, `Runtime.evaluate`) + teclas por SSAP, como a `tv-perf.mjs` faz.
O que funcionou em 12/10/2026:

- **Sessões**: embrulhar `XMLHttpRequest.prototype.open/send` na página e
  anotar url, status e tempo no `loadend` — `.m3u8` sem token = sessão nova.
  No XHR binário (segmentos) `responseText` **lança**: use `response.byteLength`.
- **Tempo até tocar**: eventos do `<video>` (`emptied` = começou a troca,
  `loadedmetadata`, `seeking/seeked`, `playing`) com `performance.now()` da
  página. O mesmo `<video>` dos dois lados? Marque o elemento (`v.__tag`) antes.
- **Inspetor do Chromium 53**: `Worker.enable` lista os workers (o `Target.*`
  não existe); `Console.enable` devolve as mensagens antigas; o buffer de
  resource timing enche (~150 entradas) — `performance.clearResourceTimings()`.
- **Foto da tela**: `ssap://tv/executeOneShot` (inclui o plano de vídeo).
- **Instalar sem o Key Server**: a passphrase da sessão também destrava uma
  chave baixada antes (`ssh-keygen -p` numa cópia) — mesmo fluxo do
  `instalar()` da `tv-perf.mjs`, sem o fetch da chave.
- **Antes de dirigir a TV**: confira que ninguém está vendo (uma foto da tela
  resolve) — a bancada aperta Voltar/CH± e atrapalha quem estiver assistindo.

## 4. Pendências

- [x] **Validar na TV** o lote (12/10/2026): tudo igual ou melhor, números
      na seção 3. Worker do hls.js sobe a partir de `file://` (visto pelo
      inspetor: `Worker.workerCreated` com `assets/hls.worker.js`).
- [x] **Passear por todas as telas** no webOS (14/10/2026): Início, Filmes,
      Séries (+ modal de detalhe), Minha Lista, Configurações, busca e perfis
      abrem sem exceção nem `console.error`. Achados: título do gerenciador de
      perfis colado ("PerfisGerenciar Perfis" — o fallback de `gap` não pega
      nó de texto solto) e episódios com título "-" (" Série - S01E01 - " do
      provedor; não é do webOS). Os dois consertados. Fica de olho: outro
      flex com `gap` e texto solto ao lado de elemento cola do mesmo jeito.
      Esperado: Voltar com o teclado virtual aberto fecha só o teclado
      (a busca precisa de um segundo Voltar).
- [x] **Menu de áudio/legenda com o hls light** (14/10/2026): nada que se
      usava sumiu. O painel serve a playlist de mídia direto (sem faixas
      alternativas). RecordTV tem CEA-608 no stream (Record News e GloboNews
      não), mas o app nunca expôs 608 nem no build cheio (o menu só lista
      `hls.subtitleTracks`).
- [ ] **Variante HD/FHD** (CNN Brasil Money): na prática, depois de a HD cair
      uma vez, Home e TV ao Vivo devem abrir direto na FHD. Lógica testada
      (unit + TV com HD marcada como caída); falta ver no uso real.
      12/10/2026, CNN Internacional (HD padrão fora): CH±, guia, painéis e
      aleatório abriam a variante crua (agora `tocarCanal` → melhor
      histórico), e o player só contava acerto aos 60 s (agora 10 s) — a
      variante achada pelo failover nunca virava a padrão. Falta ver na TV
      com a HD fora de novo.
- [x] **Home ⇄ TV ao Vivo sem mover o `<video>`** (14/10/2026): camada
      única (`src/services/camadaVideo.ts`). Bancada, 3 rodadas: troca
      Home → TV ao Vivo → player → Voltar → Home **0 ms** em todos os passos
      (era 6,2–10,6 s, média 8,3 s), mesmo `<video>`, 1 playlist; prévia da
      TV ao Vivo 7,1 s → 0. Achados na TV e consertados: (a) player em tela
      cheia por baixo da sidebar (o quadro z 15 prendia o z 9998 do vídeo);
      (b) Voltar no meio de um CH± deixava o `<video>` morto em tela cheia
      com o pôster (logo do canal) por cima da página. A camada também
      escurece com o anti burn-in. Fica de olho: overlay de z baixo que cubra
      só a borda do slot (o teste de cobertura olha o meio). Visto e não
      mexido: Voltar no meio do CH− deixa a ficha no canal do zap e a prévia
      cai no logo (limite de 1 conexão com a sessão do player).
- [x] **Troca de canal: retorno imediato** (14/10/2026): logo + nome do
      canal novo ficam na tela do CH± até o primeiro `playing` (máx. 30 s),
      em vez de tela preta + "Aguardando o provedor…" (visto na TV). O tempo
      até tocar segue do painel: zap mediana 4,8 s, máx. 8 s, 1–3 falhas em
      6 por limite de conexão — só uma conta com 2 conexões resolve.
- [x] **Troca automática de variante no player** (14/10/2026): o
      `liveBufferDying` não é alarme falso — sessão nova do painel entrega
      segmentos de 10 s a cada ~16–18 s. Mas trocar numa conta de 1 conexão
      só leva 403/limite: `trocaAntecipadaPermitida` (playerDecisions) não
      troca antes da hora com `maxConnections <= 1`.
- [ ] **Prazo extra do pipeline assumido** (`LIVE_ADOPT_GRACE_MS`): o caso
      lento (>10 s pra voltar) não reapareceu nos testes; com o vídeo no
      lugar quase não se aplica mais. Confirmar no uso e, se sobrar, tirar.
- [ ] **Logos dos canais com 429** do host de imagens. 14/10/2026: o host
      responde 429 pra TV em TODA logo, até uma só depois de 60 s quieto (o PC
      na mesma rede recebe 200) — é do host, o app não resolve. Feito: falha
      vale 30 min (`logoFalho.ts`) e as que carregam viram miniatura WebP de
      128 px no IndexedDB (`logoPequeno.ts`, no máx. 2 downloads por vez;
      eram até 3500×3495). Funcionando na TV com a logo de outro host.
- [x] **Buffer do player** (14/10/2026): **fica em 30 s** ("equilibrado").
      Medido no player em tela cheia (canal 720p, renderer do WebAppMgr por
      SSH + `video.buffered` pelo inspetor, a cada 3 s): com 30 s, 13–21 s à
      frente e 31–37 s atrás; com 60 s ("generoso"), os MESMOS 13–21 s à
      frente e 60–67 s atrás. À frente o teto é a borda do ao vivo
      (`liveSyncDurationCount: 2` = ~20 s atrás da borda), não o perfil:
      subir só dobra o buffer de trás, que nada usa (voltar no ao vivo é
      pelo catch-up). Por isso o buffer de trás **ao vivo é 0** (o VOD
      mantém, pra voltar no filme): 9–17 s atrás (só o segmento atual),
      renderer 117–134 MB e 167–185 MB livres — ~20 MB a mais na TV. Memória igual nos dois (renderer 135–157 MB, 137–164 MB
      livres na TV; a prévia sozinha 117–138 MB, sem vídeo 99 MB) — os dados
      do MSE não parecem morar no renderer. Se travar por rede, a alavanca é
      a distância da borda (3 segmentos = +10 s de folga e de atraso, e zap
      mais lento), não o perfil.
- [x] **Foco da grade re-renderiza a página inteira** (12/10/2026): o foco
      foi pro `src/pages/ChannelGrid.tsx` (memo; o LiveTV fala por `ref`).
      Grade: mediana 194 → 114–124 ms, p90 755 → 396–713 ms (6 rodadas). O
      máximo (1,7–2,2 s) segue sendo os picos do item abaixo.
- [x] **Bancada: cenários `zap` e `assistir`** (14/10/2026): zap = CH+/CH−
      alternados ×6 (termina no canal de partida), do `emptied` ao `playing` +
      sessões; assistir = Assistir/Voltar com o mesmo `<video>` e
      `readyState` mínimo. Baseline regravado (14/10, 3 rodadas): grade
      mediana 127 ms / p90 290 / máx. 599; Home 5,7 s do boot; assistir
      `rs_min` 4 e 1 sessão; CPU parada 18–22 % (era 15; a camada mede o slot
      a cada 500 ms). Entre rodadas a bancada espera 30 s: sem isso o painel
      ainda segurava a sessão e a prévia da Home não tocava.
- [x] **Picos de 2–4 s na grade** (14/10/2026): não reproduziram (máx.
      184 ms em 60 teclas com 3 inversões, sem logos carregando). Suspeita:
      decodificar as logos gigantes — resolvido pelas miniaturas. Bancada:
      máx. 1535 → 599 ms.
- [x] **"Foco visível" 76 %**: 100 % nas 6 rodadas depois do lote (sem as
      transições, o quadro medido já é o final).
- [ ] **Home vazia** uma vez ao voltar da TV ao Vivo (sem seções); um reload
      resolveu e não reproduziu. Ficar de olho.
- [ ] **Carregar telas raras sob demanda** (Configurações, perfis, modal de
      detalhes, QR): não reduz o pacote, encurta o parse no boot. Exige sair
      do bundle único (iife) dos builds de TV — só se o boot incomodar.
- [x] **Polyfill de ResizeObserver** (14/10/2026): já é 1 s com cache de
      tamanho e não aparece no perfil. Deixado como está.
