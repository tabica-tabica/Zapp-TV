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
  o pipeline sem engasgo (TV ao Vivo → player já faz assim; Home ⇄ TV ao
  Vivo ainda move, ver pendências).
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
npm run perf:tv -- <ip-da-tv> --only grade,troca       # cenários: home, grade, troca, ocioso
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
- [ ] **Abrir o menu de áudio/legenda num canal ao vivo** com o hls light e
      confirmar que nada que se usa sumiu.
- [ ] **Variante HD/FHD** (CNN Brasil Money): na prática, depois de a HD cair
      uma vez, Home e TV ao Vivo devem abrir direto na FHD. Lógica testada
      (unit + TV com HD marcada como caída); falta ver no uso real.
      12/10/2026, CNN Internacional (HD padrão fora): CH±, guia, painéis e
      aleatório abriam a variante crua (agora `tocarCanal` → melhor
      histórico), e o player só contava acerto aos 60 s (agora 10 s) — a
      variante achada pelo failover nunca virava a padrão. Falta ver na TV
      com a HD fora de novo.
- [ ] **Home ⇄ TV ao Vivo sem mover o `<video>`** (troca de página lenta):
      voltar a tocar leva 6–11 s (era 6–16 s). A prévia → player da TV ao
      Vivo já é instantânea (vídeo no lugar, 12/10/2026); entre páginas o
      `<video>` ainda é movido (a página desmonta) e o `recoverMediaError`
      refaz o MediaSource. Precisa de uma camada de vídeo única na raiz do app.
- [ ] **Troca de canal: retorno imediato.** Hoje 4,3–6,2 s do início da
      troca até tocar, 7,7–21 s quando esbarra no limite de 1 conexão (o
      painel segura a anterior por 6–16 s — só uma conta com 2 conexões
      resolve isso). Mostrar nome/logo do canal novo na hora, por cima do
      último quadro, em vez de tela preta + "Aguardando o provedor…".
- [ ] **Troca automática de variante no player** ("Sinal fraco — preparando…"):
      visto 38391 tocando bem e, 13 s depois, o player trocar sozinho pra
      42411 — sessão nova, limite, 11 s esperando. Ver se o
      `liveBufferDying` dispara à toa (segmentos de 10 s) e se vale trocar
      numa conta de 1 conexão.
- [ ] **Prazo extra do pipeline assumido** (`LIVE_ADOPT_GRACE_MS`): o caso
      lento (>10 s pra voltar) não reapareceu nos testes; com o vídeo no
      lugar quase não se aplica mais. Confirmar no uso e, se sobrar, tirar.
- [ ] **Logos dos canais com 429** do host de imagens (dezenas por visita à
      TV ao Vivo). Não afeta o vídeo; cache das capas ou menos requisições.
- [ ] **Buffer do player**: perfil "equilibrado" = 30 s ao vivo (processo
      135–167 MB, ~150 MB livres na TV). Decidir se sobe (o "generoso" tem
      60 s) agora que a prévia foi pra 20 s.
- [x] **Foco da grade re-renderiza a página inteira** (12/10/2026): o foco
      foi pro `src/pages/ChannelGrid.tsx` (memo; o LiveTV fala por `ref`).
      Grade: mediana 194 → 114–124 ms, p90 755 → 396–713 ms (6 rodadas). O
      máximo (1,7–2,2 s) segue sendo os picos do item abaixo.
- [ ] **Bancada: cenários `zap` e `assistir`** na `tv-perf.mjs` (CH+ ×5 do
      `emptied` ao `playing` + sessões novas; Assistir/Voltar com o mesmo
      `<video>` e `readyState` sem queda) — hoje só por medição avulsa (seção 3).
      Depois, regravar o baseline: o atual (12/10) é de antes da grade em
      componente próprio, do vídeo no lugar e da troca de canal mais rápida.
- [ ] **Picos de 2–4 s na grade** ao inverter o sentido da rolagem (vistos na
      v1.2.0 e depois). Perfilar com `scripts/tv-perf.mjs` + perfil de CPU.
- [x] **"Foco visível" 76 %**: 100 % nas 6 rodadas depois do lote (sem as
      transições, o quadro medido já é o final).
- [ ] **Home vazia** uma vez ao voltar da TV ao Vivo (sem seções); um reload
      resolveu e não reproduziu. Ficar de olho.
- [ ] **Carregar telas raras sob demanda** (Configurações, perfis, modal de
      detalhes, QR): não reduz o pacote, encurta o parse no boot. Exige sair
      do bundle único (iife) dos builds de TV — só se o boot incomodar.
- [ ] **Polyfill de ResizeObserver** mede tudo a cada 1 s (força layout).
      Baixo impacto; deixar a não ser que apareça no perfil.
