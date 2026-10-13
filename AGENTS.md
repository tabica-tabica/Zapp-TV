# AGENTS.md

Guia curto pra quem (gente ou agente) vai mexer no código. O README explica o
produto; aqui ficam as regras de trabalho e onde está o conhecimento que não
dá pra deduzir lendo o código.

## Projeto

App de IPTV (Xtream) em React 19 + TypeScript + Vite, com 4 alvos de build:
web, desktop (Tauri), Samsung Tizen (Chromium 69) e **LG webOS 4 (Chromium 53)**.
O alvo mais restrito — e o que mais quebra — é o webOS.

## Pendências (comece por aqui)

- **TV (webOS/Tizen):** seção 4 de [`docs/WEBOS_DESEMPENHO.md`](docs/WEBOS_DESEMPENHO.md)
  — lista viva, atualizada a cada sessão. Item feito vira `[x]` com data e número medido.
- **Desktop (Tauri):** [`TODO.md`](TODO.md).

## Antes de mexer

- **Player, prévia ao vivo, grade da TV ao Vivo, CSS de TV ou bundle:** leia
  [`docs/WEBOS_DESEMPENHO.md`](docs/WEBOS_DESEMPENHO.md). Tem as armadilhas do
  Chromium 53 vistas numa TV de verdade (vídeo some com canto arredondado,
  `<video>` movido perde o pipeline, `Element.scrollTo` não existe, Voltar é
  `RCUBack`/461...), as decisões de desempenho e as **pendências**.
- Navegação/foco/inputs: [`docs/CHECKLIST_WEBOS.md`](docs/CHECKLIST_WEBOS.md) e
  [`docs/CHECKLIST_TIZEN.md`](docs/CHECKLIST_TIZEN.md).
- Os comentários no código explicam o PORQUÊ de quase tudo que parece estranho
  (com data e o que foi visto na TV). Leia antes de "simplificar".

## Portões (rodar antes de commitar)

```bash
npx tsc -b              # o type-check do build (tsc --noEmit deixa passar erro)
npm run lint            # ESLint, alvo Tizen (chrome >= 69)
npm run lint:webos      # ESLint contra o Chromium 53 + polyfills do webOS
npm test                # Vitest
npm run check:css       # CSS que a TV ignora
npm run build:tizen && npm run check:bundle   # orçamento de bundle (subir teto só de propósito, com nota)
npm run build:webos     # confere assets e polyfills declarados
```

Polyfill novo: entra em `scripts/tizen-polyfills.mjs` (lista explícita por
alvo), nunca `modernPolyfills: true`.

## Testar numa TV LG de verdade

- `npm run package:webos` gera o `.ipk`; `npm run install:webos` instala
  (Modo Desenvolvedor + Key Server ligados; a passphrase da tela vale por sessão).
- `npm run perf:tv -- <ip-da-tv> --runs 3` — bancada que dirige o app pelo
  controle de rede e mede pelo inspetor; compara com o baseline em `.tv-perf/`.
  **Ninguém pode estar usando a TV** durante a medição.
- A conta do painel tem **1 conexão**: abrir/fechar o app em sequência ou
  testar stream fora da TV enquanto ela toca derruba a prévia por "limite".

## Convenções

- Commits: conventional commits em **português** (`fix(tv): ...`,
  `perf(tv-ao-vivo): ...`), corpo explicando causa e efeito medido.
- Fluxo: commit direto na `main`, sem PR.
- **Nunca** escrever host/IP/nome do provedor IPTV nem credenciais de conta em
  código, comentário, doc, fixture ou mensagem de commit — o repositório é
  público. Diga "o painel" / "o provedor".
- Código, comentários e docs internas em português; README em inglês.
- Teste junto com lógica nova não trivial; pra bug visto na TV, um teste que
  falha sem o conserto.
