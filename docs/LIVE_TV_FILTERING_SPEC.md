# Redução de ruído na TV ao Vivo — spec

Consolida a estratégia construída ao longo de várias rodadas pra reduzir a
grade de "TV ao Vivo" a canais reais, sem perder acesso a nada — tudo
reversível pelo usuário em Configurações. Serve de referência pra manter os
mecanismos consistentes e pra guiar extensões futuras (novo padrão, novo
provedor, novo tipo de ruído).

## Resultado medido (conta de teste real de um provedor Xtream Codes)

| Estágio | Canais |
|---|---|
| Catálogo bruto do provedor | 2.958 |
| Após categorias "ruído" inteiras + bloqueio adulto por PIN | ~1.540 |
| Após agrupar variantes de qualidade (FHD/HD/SD/4K num card só) | ~1.000 |
| Após dedup de afiliadas regionais/redes nacionais | ~590 |
| Após categorias "só com tag de qualidade" (Esportes, Variedades) | ~260 |
| **Estado atual, com todos os padrões acumulados** | **223** |

Cada rodada de ajuste (adicionar uma categoria "ruído", adicionar uma
categoria "só com tag", corrigir o agrupamento de uma marca) foi validada
contra o catálogo real ANTES de entrar no código — nunca um padrão novo sem
antes rodar um script Python/Node conferindo quantos canais ele afeta e se
cria algum agrupamento errado em categorias não relacionadas.

## Visão geral da pipeline

A grade de "TV ao Vivo" (`src/pages/LiveTV.tsx`) passa a lista bruta de
canais por 5 estágios, NESSA ORDEM — a ordem é uma decisão de arquitetura
deliberada, não incidental (ver seção "Por que a ordem importa" abaixo):

```
streams (catálogo bruto do provedor)
  │
  ▼
① processedStreams   — ocultação manual, categorias "ruído" INTEIRAS,
                        bloqueio adulto por PIN, categoria selecionada, busca
  │
  ▼
② rawGrouped          — groupChannelVariants(): FHD/HD/SD/4K, H265/HEVC/AVC,
                        Legendado [L], servidor espelhado (A)/(B), tag-antes-
                        do-número, acento — tudo vira 1 card por canal real
  │
  ▼
③ qualityGrouped      — categorias "só com tag de qualidade" (Esportes,
                        Variedades): filtra o REPRESENTANTE de cada grupo
  │
  ▼
④ filteredStreams     — dedup de afiliadas regionais (por NOME) e redes
                        nacionais (por CATEGORIA inteira): só a 1ª praça
                        aparece, resto vira opção em Configurações
  │
  ▼
grade final
```

## 1. Categorias "ruído" inteiras — `curatedHiddenGroups.ts`

Categorias que não têm nenhum canal "de verdade" pro usuário médio —
curiosidades, treino/aulas/receitas, câmeras ao vivo, rádios, shows/eventos
avulsos, maratonas 24h, e uma lista crescente de redes/serviços específicos
que o usuário foi pedindo pra tirar (CazeTV, DAZN, Religiosos, Fórmula 1,
Brasileirão, NBA League Pass, UFC Fight Pass, Estaduais, Dual Audio, Prime
Video...). A categoria INTEIRA some da grade por padrão.

```ts
export const JUNK_CATEGORY_PATTERNS: JunkCategoryPattern[] = [
    { key: 'educativos', pattern: 'educat' },
    { key: 'curiosidades', pattern: 'curiosidad' },
    { key: 'alfabeto', pattern: 'alfabet' },
    { key: 'treino', pattern: 'treino' },
    { key: 'receitas', pattern: 'receita' },
    { key: 'aulas', pattern: 'aula' },
    { key: 'cameras', pattern: 'camera' },
    { key: 'radios', pattern: 'radio' },
    { key: 'shows', pattern: 'show' },
    { key: '24h', pattern: '24h' },
    { key: 'dormir', pattern: 'dormir' },
    { key: 'cinebit', pattern: 'cine bit' },
    { key: 'cazetv', pattern: 'caze' },
    { key: 'dazn', pattern: 'dazn' },
    { key: 'religiosos', pattern: 'religios' },
    { key: 'formula1', pattern: 'formula' },
    { key: 'brasileirao', pattern: 'brasileir' },
    { key: 'nba', pattern: 'nba' },
    { key: 'ufc', pattern: 'ufc' },
    { key: 'estaduais', pattern: 'estaduais' },
    { key: 'dualaudio', pattern: 'dual audio' },
    { key: 'primevideo', pattern: 'prime video' },
];
```

**Detecção é DINÂMICA**, nunca uma lista fixa de IDs: cada padrão é um
substring genérico (sem acento/maiúsculo, via `normalizeSearch`) testado
contra `category_name` de cada categoria da playlist ATIVA, recalculado
sempre que a lista de categorias muda. Isso é o que faz o mecanismo
funcionar em QUALQUER provedor Xtream sem reconfiguração — dois provedores
nunca usam os mesmos `category_id`, mas tendem a usar nomenclatura parecida
em português pra esse tipo de conteúdo.

Duas categorias reais diferentes batendo no mesmo padrão (ex.: "Canais | 24h
Infantil" e "Canais | 24h Variados" batendo em `24h`) viram DOIS grupos
independentes, cada um toggleável sozinho — a chave do grupo é o
`category_id` real, não o `patternKey`.

## 2. Categorias "só com tag de qualidade" — ocultação parcial

Diferente do caso acima: "Esportes" e "Variedades" têm uma MISTURA de canais
de qualidade normal (`Combate FHD`, `GNT FHD`, `Esporte Interativo HD`) ao
lado de dezenas de feeds de evento avulso sem NENHUMA indicação de qualidade
(`Canal do Poker`, `BJJ STARS`, `Tastemade`, `FIFA+ 01 (B)`) — ocultar a
categoria inteira perderia canal de verdade; não ocultar nada mantém o ruído.

```ts
export const QUALITY_ONLY_CATEGORY_PATTERNS = ['esporte', 'variedad'];

const QUALITY_TAG_RE = /(^|[^a-z0-9])(4k|uhd|fhd|hd)([^a-z0-9]|$)/i;
```

A regra: dentro dessas categorias, só ficam visíveis por padrão os canais
cujo NOME tem uma tag de qualidade reconhecida (4K/UHD/FHD/HD — **não** SD,
de propósito). A visibilidade padrão é POR CANAL, não um boolean único pra
categoria inteira — por isso essas categorias não entram na lista de
"grupos" com toggle de bloco no overlay de Configurações, só aparecem
individualmente na busca.

## 3. Bloqueio adulto por PIN — `useAdultLock.ts` (pré-existente)

Categorias detectadas como adultas (`isAdultCategoryName`) ficam trancadas
por PIN e somem da visão "Todos" até o usuário desbloquear — mecanismo
anterior a esta rodada de trabalho, mas faz parte da mesma cadeia de
filtros (roda dentro de `processedStreams`, antes do agrupamento).

## 4. Agrupamento de variantes de qualidade — `channelVariants.ts`

"ESPN FHD", "ESPN HD" e "ESPN SD" são o MESMO canal — viram 1 card na grade,
com a melhor qualidade tocando por padrão e as demais como botões no menu
"Qualidade" do player. A chave de agrupamento (`variantBaseName`) tira, nessa
ordem:

1. **Tag de qualidade/codec** — `FHD`/`HD`/`SD`/`4K`/`UHD`/`H265`/`H.265`/
   `HEVC`/`AVC`, solta no fim OU entre parênteses/colchetes cujo conteúdo é
   só a tag (`ESPN (FHD)`). Codec sozinho (`H265` sem `FHD`/`HD` por perto)
   também conta — dezenas de famílias do catálogo real usam `H265` como o
   PRÓPRIO rótulo de qualidade.
2. **`[L]` (Legendado)** — mesmo canal, versão com áudio original + legenda
   em vez de dublado (`HBO FHD [L]`). Entra no MESMO grupo do dublado, mas
   NUNCA vira o representante quando existe irmão dublado de qualidade
   igual ou melhor (mesmo empate de qualidade) — legendado é uma OPÇÃO no
   menu, não o padrão silencioso. Só vira representante se o grupo inteiro
   for legendado (ex.: `Sony FHD [L]`/`Sony HD [L]`, sem irmão dublado no
   catálogo).
3. **`(A)`/`(B)` (servidor espelhado)** — mesmo conteúdo, links diferentes,
   redundância de provedor (`Paramount+ 1 (A)`, `Paramount+ 1 FHD (B)`).
   Rótulo no menu vira `FHD · B` (ou `Servidor A` quando não há tag de
   qualidade nenhuma, só o marcador de servidor).
4. **Tag ANTES do número** (`MID_TAG_BEFORE_NUMBER_RE`) — achado em "Canais
   | Disney+": o espelho A numera `Disney+ HD 2` (tag antes do número), o
   espelho B numera `Disney+ 2 HD`/`Disney+ 2` (número antes da tag). Sem
   normalizar a ordem, os dois espelhos do MESMO canal nunca batiam a mesma
   raiz.
5. **Acento** (`foldAccents`, NFD + remove marca combinante — mesma técnica
   de `normalizeSearch`) — "TNT Séries FHD" (com acento) e "TNT Series H265"
   (sem acento) são o mesmo canal, grafia inconsistente do próprio provedor
   entre variantes. Só a CHAVE de agrupamento perde o acento;
   `channelDisplayName` (usado pra exibição) preserva a grafia original.

O representante do grupo (o que toca ao clicar o card) é sempre a melhor
qualidade disponível — LEGENDADO nunca ganha essa posição de um dublado de
qualidade igual/melhor (ver item 2). O ÍCONE do grupo, por outro lado, vem
da variante de PIOR qualidade (ou sem tag nenhuma) — o logo dela costuma vir
mais confiável que o das variantes FHD/H265 recém-adicionadas pelo provedor.

## 5. Dedup de afiliadas regionais por NOME — `regionalVariants.ts`

`detectRegionalFamilies`: "RedeTV! Guará"/"RedeTV! Imperial"/"RedeTV! Paraná"
são a mesma marca, praça (cidade) diferente — só a primeira aparece por
padrão, resto vira opção em Configurações → "Canais regionais". A heurística
exige um "canal-mãe" que EXISTE de verdade no catálogo sem a palavra extra
(evita falso-positivo tipo "Urban Sports"/"Urban Movies", que são canais
DIFERENTES, não praças de "Urban"), e uma lista de palavras de
gênero/categoria (`Esportes`, `Kids`, `News`...) que nunca contam como praça
mesmo quando o canal-mãe existe (`Woohoo` + `Woohoo Esportes` não merge).
Famílias aninhadas (RecordTV → RecordTV Bahia → RecordTV Bahia Itabuna)
achatam numa família só, pela marca raiz.

## 6. Dedup de redes nacionais por CATEGORIA — `detectCategoryFamilies`

A heurística acima falha pra Globo/SBT/RecordTV/Band/"Canais | Abertos":
nenhum provedor oferece um canal-mãe nu ("Globo" sozinho não existe, só as
praças — "Globo SP", "EPTV Campinas", "RBS TV Porto Alegre"), e boa parte
dos nomes de praça tem 2+ palavras extras (cidade + estado), que a regra "só
a última palavra pode ser praça" não cobre. Resultado sem esse tratamento:
~183 canais em "Canais | Globo" sozinhos, quase nenhum agrupado.

```ts
export const NETWORK_CATEGORY_PATTERNS = ['abertos', 'sbt', 'record', 'band', 'globo'];
```

Como toda a CATEGORIA já É a rede (cada entrada é uma praça/afiliada), a
categoria inteira vira 1 família — mesmo default "só a primeira aparece",
mesma tela de Configurações. Roda DEPOIS do agrupamento de qualidade
(`qualityGrouped`, não `processedStreams`), senão "ESPN 2 H265"/"ESPN 2
FHD" apareceriam como se fossem praças regionais distintas.

## Exceção individual — bidirecional

Toda categoria "ruído" ou "só com tag" aceita exceção por canal, nas DUAS
direções: revelar 1 canal específico dentro de um grupo/categoria ainda
oculto, OU ocultar 1 canal específico dentro de um grupo/categoria visível.

```ts
export function computeEffectiveVisibility(streamId, defaultVisible, overrides): boolean
export function toggleOverride(overrides, streamId, defaultVisible): Map<number, boolean>
```

`toggleOverride` só grava uma exceção quando o resultado DIVERGE do padrão —
se o toggle faz o canal convergir de volta ao padrão do grupo, a exceção é
removida (armazenamento não incha com exceções redundantes).

## Persistência

Todas as chaves são escopadas por **PLAYLIST** (não por perfil, igual
`regionalPrefs.ts`) — é dado do catálogo do provedor, não de quem está
assistindo, e dois provedores têm catálogos diferentes.

| Chave | Conteúdo |
|---|---|
| `neostream_curated_unhidden_categories_<playlist>` | `category_id[]` desocultados por inteiro |
| `neostream_curated_channel_overrides_<playlist>` | `[streamId, boolean][]` — exceção individual |
| `neostream_regional_prefs_<playlist>` | `{ familyKey: streamId[] }` — quais praças/redes o usuário quer ver, por família (nome OU `cat:<id>`) |

## Superfície de UI

- **Settings → "Gerenciar canais ocultos por padrão"** (`HiddenGroupsOverlay.tsx`):
  lista as categorias "ruído" detectadas (toggle de bloco, com contagem
  real) e permite buscar QUALQUER canal de QUALQUER categoria detectada —
  "ruído" OU "só com tag de qualidade" — pra alternar individualmente.
  Categorias "só com tag" não aparecem na lista de blocos (não haveria um
  boolean único fazendo sentido), só nos resultados de busca.
- **Settings → "Canais regionais"**: lista toda família detectada (por nome
  OU por categoria de rede), com um botão por variante — usuário marca
  quais praças/afiliadas quer ver além da primeira.

## Por que a ordem importa (lição real)

A primeira versão de "categoria só com tag de qualidade" rodava o corte
ANTES do agrupamento de variantes. Bug real: "GNT" (sem tag) era descartado
ANTES de ter a chance de ser reconhecido como fallback de "GNT FHD" — a
variante sem tag simplesmente desaparecia, em vez de virar uma opção a mais
dentro do card sobrevivente. Corrigido movendo o corte pra DEPOIS do
agrupamento (`qualityGrouped`, checando o REPRESENTANTE do grupo, não cada
`stream_id` cru): um grupo com QUALQUER variante taggeada passa inteiro (o
representante, por definição, é a de melhor qualidade), e só fica de fora o
grupo em que NENHUMA variante tem tag nenhuma.

Regra geral pra qualquer filtro novo que dependa do NOME do canal: se o
corte pode acidentalmente eliminar uma variante que faria sentido como
fallback dentro de um grupo, ele tem que rodar DEPOIS do
`groupChannelVariants`, olhando o representante — nunca antes.

## Como estender

**Adicionar uma categoria "ruído" nova** (esconder inteira): acrescentar
`{ key, pattern }` em `JUNK_CATEGORY_PATTERNS` (`curatedHiddenGroups.ts`).
Antes de commitar, validar contra o catálogo real: o padrão bate SÓ na
categoria pretendida (sem colisão com outra categoria não relacionada)?

**Adicionar uma categoria "só com tag de qualidade"** (esconder parcial):
acrescentar o substring em `QUALITY_ONLY_CATEGORY_PATTERNS`.

**Adicionar uma rede nacional à dedup por categoria**: acrescentar o
substring em `NETWORK_CATEGORY_PATTERNS` (`regionalVariants.ts`).

**Ensinar o agrupador de variantes a reconhecer um marcador novo**: seguir o
padrão de `[L]`/`(A)(B)` em `channelVariants.ts` — decidir se o marcador
entra na CHAVE (`variantBaseName`, pra agrupar) e/ou no RÓTULO
(`qualityLabel`, pra diferenciar no menu), e se precisa de desempate na
ordenação do representante (como `subtitled` faz pro Legendado).

Em TODOS os casos: escrever um script Python/Node contra o catálogo real
(`live-categories.json`/`live-streams.json` cacheados, ou um fetch novo)
ANTES de mexer no TypeScript, contando quantos grupos NOVOS o padrão cria e
inspecionando cada um manualmente por falso-positivo. Só depois portar pro
código + testes (`*.test.ts`) + verificação ao vivo via Playwright.

## Limitações conhecidas (aceitas, não são bugs)

- **Disney+**: o espelho "A" do canal 1 se chama só `Disney+ HD` (sem
  número nenhum) — fica como card solto, separado de `Disney+ 1 HD (B)`.
  Merge-lo exigiria assumir "sem número = canal 1", regra frágil demais pro
  resto do catálogo (arriscaria juntar canais errados noutra família).
- **Overlay de busca é por canal CRU, não por grupo**: pra categorias "só
  com tag de qualidade", a busca em Configurações lista `GNT`, `GNT FHD`,
  `GNT H265` e `GNT HD` como 4 linhas independentes (o catálogo cru, não
  agrupado) — só a exceção no streamId do REPRESENTANTE (`GNT FHD`, nesse
  caso) tem efeito visível na grade; alternar as outras 3 não muda nada
  sozinho. Redesenhar o overlay pra ser "ciente de grupo" é escopo maior,
  não fez parte desta rodada.
- **Escape no campo de busca do overlay fecha o overlay inteiro** (bug
  pré-existente, não desta rodada): o evento borbulha pro `onBack` global
  em vez de só sair do modo de edição do campo.
