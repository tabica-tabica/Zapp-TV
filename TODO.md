# TODO

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
