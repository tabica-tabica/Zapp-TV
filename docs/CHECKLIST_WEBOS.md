# Checklist webOS / TV-first

Use antes de empacotar para LG webOS ou quando mexer em
navegação, foco, inputs ou player. Espelha docs/CHECKLIST_TIZEN.md — as
seções de Foco visível, Inputs, Player e Visual em TV são as mesmas
restrições, agnósticas de plataforma; só D-pad e Build mudam.

## Navegação por D-pad
- [ ] ↑ ↓ ← → movem foco em todas as direções esperadas
- [ ] Enter (OK) ativa o item focado
- [ ] Back (tecla Voltar do controle) volta uma camada e nunca fecha o app sem intenção
- [ ] Nenhum item interativo fica inalcançável só com D-pad (sem depender de mouse)
- [ ] Em modais/players, o D-pad da página é desativado
  (`useTVNavigation({ enabled: false })`) e o controle vai para o modal
- [ ] webOS Back (keyCode `461`) fecha teclado/volta camada — já tratado
  genericamente por `useTVNavigation.ts`, sem handler específico de plataforma
- [ ] Na tela raiz, Back aciona `webOS.platformBack()` (via `services/platformApp.ts`)
  em vez de tentar matar o processo — webOS suspende o app, não sai dele

## Foco visível
- [ ] Todo elemento focável tem indicador visual claro (outline, scale, borda)
- [ ] Foco inicial faz sentido ao entrar em cada tela
- [ ] Ao fechar modal/player, o foco volta para o elemento que abriu

## Inputs (crítico na TV)
- [ ] Inputs do Login continuam descontrolados (uncontrolled)
- [ ] Sem `type="password"` (usar máscara manual) e sem `readOnly`
- [ ] Backspace funciona durante digitação
- [ ] `useTVNavigation` é bypassado quando o foco está num input

## Player
- [ ] Abre ao Enter ou ao clicar em "Assistir"
- [ ] Botão "Fechar" e tecla Back fecham o player
- [ ] `isLive`/`contentType="live"` setados corretamente para canais ao vivo
- [ ] Quality menu navega com D-pad
- [ ] Em VOD, posição de retomada (`resumeTime`) é respeitada

## Build
- [ ] `npx tsc --noEmit` passa sem erros
- [ ] `npm run lint` passa sem warnings
- [ ] `npm run build` (Web) gera artefatos sem erro
- [ ] `npm run build:webos` gera output com transpile legacy aplicado
- [ ] `webos/appinfo.json` com `id`/`version` corretos para release
  (o `id` atual é um placeholder — confirmar contra o id reservado na LG Seller Lounge)
- [ ] `disableBackHistoryAPI: true` presente em `appinfo.json`

## Visual em TV
- [ ] Layout legível a ~3m de distância (fontes ≥ 22px em listas, ≥ 32px em títulos)
- [ ] Contraste alto, evitar cinza-claro sobre branco
- [ ] Sem scroll com mouse — tudo deve responder a Page Up/Down ou D-pad
- [ ] Imagens com fallback (`useBrokenImages` já implementado em LiveTV/Movies/Series)

## Não coberto por este checklist (precisa de dispositivo real)
- [ ] `webOS.platformBack()` / `PalmSystem.close()` testados num aparelho de verdade
- [ ] Abrir o trailer externo (`window.open`) validado — best-effort não confirmado
- [ ] `ares-inspect` sem erros de console na TV
