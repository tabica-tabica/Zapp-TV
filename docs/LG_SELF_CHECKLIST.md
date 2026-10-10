> RASCUNHO — pendente de teste em hardware webOS real; não submeter à LG até
> cada seção abaixo estar preenchida com resultado de teste real, não suposição.
> Rejeição automática se incompleto (spec `.agents/smart-tv.md` §4.2).

# Self-Checklist — Zapp TV (webOS)

Autoavaliação exigida na submissão da LG Seller Lounge. Cada item precisa do
resultado de um teste real em TV, não de uma suposição sobre o código.

## Instalação e boot

- [ ] `.ipk` instala sem erro via `ares-install` num aparelho real
- [ ] App abre e chega à tela de idioma/login em tempo aceitável
- [ ] Nenhum erro no console (`ares-inspect`) durante o boot

## Navegação

- [ ] Todas as telas alcançáveis só com D-pad (ver docs/CHECKLIST_WEBOS.md)
- [ ] Tecla Back se comporta como esperado em cada tela (volta uma camada,
  nunca fecha o app sem aviso — ver `useExitPrompt`)
- [ ] Foco nunca "se perde" (nenhum estado em que nenhum elemento está focado)

## Player

- [ ] Reprodução ao vivo inicia e mantém o stream
- [ ] Reprodução VOD com retomada de posição funciona
- [ ] Troca de qualidade/variante funciona com D-pad
- [ ] Fechar o player devolve o foco pro elemento que abriu

## Estabilidade

- [ ] Uso contínuo de 30+ min sem degradação perceptível de memória/desempenho
- [ ] Sair e reabrir o app preserva configurações e listas salvas
- [ ] Trocar de canal repetidamente (zapping) não trava nem vaza memória

## Conformidade de conteúdo

- [ ] App não hospeda, vende nem distribui conteúdo — só reproduz playlists
  Xtream que o próprio usuário fornece (ver disclaimer no README.md)
- [ ] Nenhuma credencial de terceiro embutida no bundle

## Metadados da submissão

- [ ] `webos/appinfo.json`: `id` confirmado contra o reservado na Seller Lounge
  (o valor atual, `com.tabica.zapptv`, é um placeholder)
- [ ] Ícones (`icon.png` 80×80, `largeIcon.png` 130×130) presentes e corretos
- [ ] Screenshots 1280×720 preparados
- [ ] `docs/LG_UX_SCENARIO.md` preenchido com resultado real
