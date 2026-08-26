# m3u-transformer

CLI standalone que normaliza uma lista M3U de IPTV: detecta ao vivo vs. VOD,
identifica áudio (Dublado/Legendado/Dual/Original) e qualidade (4K/FHD/HD/SD)
a partir do nome/URL de cada item, agrupa variações do mesmo conteúdo e
regrava tudo num `.m3u` novo, pronto para qualquer player.

Implementa `.agents/m3u-transformer.md`. **Sem relação com o app Zapp
TV** — é uma ferramenta de linha de comando isolada, com seu próprio
`package.json` e zero dependências de terceiros.

## Uso

```bash
node --experimental-strip-types transform.ts --input lista.m3u --output saida.m3u
```

Ou, de dentro desta pasta:

```bash
npm run transform -- --input lista.m3u --output saida.m3u
```

`--input` aceita um caminho local ou uma URL `http(s)://` (baixada via `fetch`).

| Flag | Default | Descrição |
|---|---|---|
| `--input <path\|url>` | *(obrigatório)* | Lista M3U de entrada |
| `--output <path>` | `output.m3u` | Arquivo de saída |
| `--default-group-vod <nome>` | `Filmes` | `group-title` para VOD sem um definido |
| `--default-group-live <nome>` | `Canais` | `group-title` para canais sem um definido |
| `--dry-run` | — | Só imprime o relatório, não grava nada |
| `--help` | — | Mostra a ajuda |

Precisa do Node ≥ 22.6 (o `--experimental-strip-types` é nativo do Node, sem
`ts-node`/`tsx`). Node 23.6+ nem exige a flag.

## O que ele faz

1. **Tipo**: `.ts` é canal ao vivo; qualquer outra extensão (`.mp4`, `.mkv`,
   `.avi`, ...) é VOD. Uma exceção: se o `group-title` de um `.ts` começa com
   "Filmes"/"Séries"/"VOD" (ex.: `"Filmes | Ação"`), o item vira VOD mesmo com
   URL `.ts` — cobre listas que hospedam VOD como stream ao vivo.
2. **Qualidade**: 4K > FHD > HD > SD, por regex no título e, se não achar
   nada, na URL. Default: `SD`.
3. **Áudio**: Dual Áudio > Dublado > Legendado > Original > Não especificado,
   mesma lógica de fallback pra URL.
4. **Agrupamento**: itens da mesma raiz (mesmo tipo + mesmo título sem os
   tokens de áudio/qualidade) ficam adjacentes na saída, ordenados por
   qualidade e depois por áudio. A ordem GERAL da lista (que raiz vem antes
   de qual) é a ordem de primeira aparição no arquivo de entrada — não é
   re-embaralhada, com uma exceção: grupos de conteúdo adulto (item 7) vão
   pro início, preservando a ordem de aparição DENTRO de cada partição.
5. **Deduplicação**: URLs exatas repetidas — a primeira ocorrência vence.
6. **Nome final**: `"{Raiz} ({Áudio} - {Qualidade})"`.
7. **Conteúdo adulto**: detectado por marca/palavra-chave conhecida (hentai, xxx,
   brazzers, brasileirinhas, playboy, milf, entre outras — ver `adult.ts`) no título OU
   no `group-title` original, mais o prefixo `[XX]`/`[XXX]` (convenção real de várias
   listas). Toda entrada detectada é consolidada sob uma única categoria
   (`group-title="🔞 Adulto"`, sobrescrevendo o original) e movida pro início do arquivo
   de saída — fácil de achar, fácil de pular.

## Calibrado contra uma lista real

As regex foram ajustadas rodando contra `.agents/tv_channels.m3u` (~213 mil
itens reais), não só contra os exemplos da spec. Os comentários marcados
"calibrado"/"achado real" em `classify.ts` documentam onde e por quê:

- **`[L]` e `[4K]` em colchete** são a marcação de legendado/qualidade mais
  comum na lista — não estavam na spec original.
- **"DUAL AUDIO" com espaço** entre as palavras.
- **"Original" livre vira falso positivo**: a lista tem filmes de verdade
  chamados "Pecado Original" e "Um Filme Original" — a spec sugeria casar a
  palavra solta. Restrito a `[Original]`/`(Original)` explícito.
- **`group-title` como sinal de VOD só funciona ancorado na categoria**: a
  spec original testava a palavra em qualquer parte do `group-title` (ou do
  título). Isso classificava errado 84 canais AO VIVO de verdade — A&E, AMC,
  AXN — porque vivem em `group-title="Canais | Filmes e Series"` (grupo de
  canais, tematicamente sobre filmes, mas ainda canal) e canais como "AMC
  Series HD" têm "Series" na marca. Corrigido pra olhar só a categoria antes
  do primeiro `|`.
- **Ruído de codec** (`H265`, `H264`, `HEVC`, `x264`/`x265`) é removido da
  raiz do título — sem isso "RedeTV! FHD" e "RedeTV! FHD H265" viravam raízes
  diferentes por acidente.
- **Conteúdo adulto — "porn" solto vira falso positivo**: a lista tem "O País da
  Pornochanchada (2020)", documentário real sobre cinema brasileiro. Ancorado com `\b`.
- **Conteúdo adulto — "adult"/"adulta" soltos também**: "Adult Swim" (bloco de
  programação real da Cartoon Network), "Adult Material"/"The Adults" e "Vida Adulta"
  são títulos legítimos sem nenhuma relação com adulto — nenhum tinha `group-title`
  correspondente. A convenção real de categoria é sempre a forma masculina
  "adulto"/"adultos" (`ADULTO 47`, `Filmes Adultos`); restrito a essa forma.
- **Conteúdo adulto — "playboy"/"erótico" ficam, com falso positivo aceito**:
  "Um Playboy em Apuros (1994)" e "Henry e June - Delírios Eróticos (1990)" são
  título/filme mainstream que usam essas palavras fora do sentido de marca/gênero
  explícito — mantidos de propósito porque a mesma lista de detecção alimenta o
  bloqueio por PIN no app Zapp TV, onde um falso NEGATIVO (deixar passar
  conteúdo adulto de verdade) pesa mais que um falso positivo (título arquivado na
  categoria errada, ainda assistível). Ver `adult.ts`.

Rode `--dry-run` numa lista nova antes de confiar cegamente nestas regex —
o relatório mostra quantos itens caíram nos dois defaults ao mesmo tempo
(nenhuma pista de qualidade OU áudio), que é o sinal de "revisar a régua".

## Testes

```bash
npm test
# ou: node --experimental-strip-types --test __tests__/*.test.ts
```

Sem framework — `node:test` + `node:assert/strict`, que já vêm no Node.
Cada caso de falso positivo calibrado acima tem um teste de regressão
correspondente.

## Estrutura

```text
types.ts       Tipos compartilhados (M3UEntry, Audio, Quality, ...)
parse.ts       Parser manual de M3U (linha a linha, sem lib)
classify.ts    Heurísticas de tipo/qualidade/áudio + normalização de raiz
adult.ts       Detecção de conteúdo adulto (título + group-title)
group.ts       Deduplicação, agrupamento e ordenação (adulto vai pro início)
render.ts      Geração do M3U de saída
io.ts          Leitura (arquivo/URL) e escrita
report.ts      Relatório de classificação (console)
transform.ts   CLI: parsing de argv + orquestração (main)
```
