> RASCUNHO — pendente de teste em hardware webOS real; não submeter à LG até
> cada seção abaixo estar preenchida com resultado de teste real, não suposição.

# UX Scenario — Zapp TV (webOS)

Documento exigido na submissão da LG Seller Lounge (spec `.agents/smart-tv.md`
§4.2). Estrutura abaixo; conteúdo real depende de teste em TV física.

## Visão geral do app

- **Nome**: Zapp TV
- **Categoria**: TODO (Entertainment / Media & Video?)
- **O que o app faz**: TODO — descrição curta (player de IPTV via Xtream Codes;
  ver README.md para o texto de referência e o disclaimer de conteúdo).

## Métodos de entrada suportados

- [ ] Controle remoto padrão (D-pad + OK + Back + teclas coloridas)
- [ ] Magic Remote (ponteiro) — TODO: testar se o app responde bem a cliques
  de ponteiro além do D-pad, ou se algum fluxo fica inacessível sem D-pad
- [ ] Teclado numérico / dígitos (zapping por número de canal)

## Fluxo de navegação principal

TODO — descrever, com prints reais de TV, o caminho: tela de idioma → login
→ Home → cada seção principal (Ao Vivo, Filmes, Séries, Minha Lista,
Favoritos, Configurações) → player.

## Resoluções testadas

- [ ] 1920×1080 — TODO: resultado
- [ ] 1280×720 — TODO: resultado (piso do checklist de screenshots da loja)

## Formatos de playback / DRM

- TODO — confirmar quais formatos o provedor Xtream do usuário de teste
  entrega (HLS é o caminho padrão do app) e se algum DRM está em jogo
  (não deveria: o app não distribui conteúdo, só reproduz o que o usuário
  já tem via sua própria assinatura Xtream — ver disclaimer no README).

## Limitações conhecidas

TODO — preencher após o teste em dispositivo real. Candidatos a checar:
- Emparelhamento com o app desktop (ainda não implementado — ver Roadmap do README)
- Abertura de trailer externo via `window.open` (não verificado em webOS real,
  ver `src/services/webosApp.ts`)

## Checklist de aceite (espelha docs/CHECKLIST_WEBOS.md)

- [ ] Navegação 100% D-pad, sem depender de mouse/ponteiro
- [ ] Foco visível em todo elemento interativo
- [ ] Player abre/fecha corretamente, retomada de VOD funciona
- [ ] Sem crash nem tela preta em nenhum fluxo principal
