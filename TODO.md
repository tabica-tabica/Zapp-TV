# TODO

## Pendências gerais (15/10/2026)

- [x] **Release v1.4.0** (15/10/2026): desktop, LG (.ipk + zip), APK do Android TV e
      texto do CHANGELOG no release.
- [ ] **Painel fora do ar desta rede** (15/10/2026): o DNS do provedor de
      internet não resolve o nome do painel (o DNS público resolve) e nem o
      servidor do painel nem o de segmentos respondem em porta nenhuma — a
      rota morre dentro da rede do provedor de internet. Pode ser o painel
      fora/trocando de servidor (os registros DNS mudaram no mesmo dia) ou
      bloqueio do provedor de internet. Conferir de outra rede (celular nos
      dados móveis abrindo `/player_api.php` do painel): qualquer resposta =
      bloqueio aqui.
- [ ] **Com o painel de volta, conferir no app desktop**: selo "LEG" nas
      séries (ex.: Bleach) e o ✕ centrado na busca e na ficha da TV ao Vivo
      — conferidos só na web, com catálogo real num painel falso local.
- [ ] **Faixa escura de 80px** entre a sidebar e o conteúdo na Home e em
      Filmes (a Minha Lista não tem) — visto no desktop; não corrigido.
- [ ] **Backup da chave de assinatura do Android**: `~/.config/zapp-tv/`
      (`android-release.p12` + `android-release.senha`; também nos secrets
      `ANDROID_KEYSTORE_B64`/`ANDROID_KEYSTORE_PASSWORD`). Perdida, nenhum APK
      novo atualiza o instalado (desinstalar apaga o login).

## TV (webOS/Tizen)

A lista de pendências da TV mora na seção 4 de
[`docs/WEBOS_DESEMPENHO.md`](docs/WEBOS_DESEMPENHO.md) (junto das medições e
armadilhas que explicam cada item). Atualize lá, não aqui.

## Desktop (Tauri, Linux) — rota do provedor pelo tauri-plugin-http

Conferido em 14/10/2026 no Arch (`scripts/install-arch.sh`), app de verdade,
pelo inspetor remoto do WebKitGTK (`WEBKIT_INSPECTOR_HTTP_SERVER`):

- [x] Login funciona
- [x] Canal ao vivo toca (prévia e player cheio, troca de canal por ↑) — os
      segmentos vêm de outro host numa porta não padrão e o escopo do
      plugin (`http://*`) só aceitava a porta padrão: "url not allowed on
      the configured scope". Escopo agora `http://*:*` / `https://*:*`.
- [x] Filme toca
- [x] Logos de canal aparecem (host sem CORS cai na URL original)

## Android TV — conferir num aparelho de verdade

APK: workflow "Release Android TV" (tag `v*` anexa no release; à mão gera o
artefato). Assinado com a chave de release fixa (secrets
`ANDROID_KEYSTORE_B64`/`ANDROID_KEYSTORE_PASSWORD`; cópia local fora do repo).
Já conferido (14/10/2026): o CI compila e assina; o bundle sobe de
`file://` no Chromium com login, Home, D-pad, OK e o Voltar despachado
(XF86Back) se comportando como no Tizen/LG. Sem aparelho, falta:

- [ ] Instalar por sideload (adb ou app de arquivos) e abrir pelo launcher
      (banner e ícone aparecem)
- [ ] Layout em 1920px reduzido pra tela (viewport width=1920)
- [ ] D-pad, OK e o Voltar físico; sair do app pela Home
- [ ] Login no painel (sem "Load failed": página em file:// com acesso universal)
- [ ] Prévia e player ao vivo (hls.js + MSE da WebView), filme, legendas
- [ ] Tela não apaga durante o filme (FLAG_KEEP_SCREEN_ON)
- [ ] Atualizar por cima da versão anterior sem perder o login (mesma chave)

