# TODO

## TV (webOS/Tizen)

A lista de pendências da TV mora na seção 4 de
[`docs/WEBOS_DESEMPENHO.md`](docs/WEBOS_DESEMPENHO.md) (junto das medições e
armadilhas que explicam cada item). Atualize lá, não aqui.

## Desktop (Tauri, Linux) — validar a rota do provedor pelo tauri-plugin-http

Instalar com `scripts/install-arch.sh` e conferir no app:

- [ ] Login funciona (antes: "Load failed" — CORS no 1º redirect do provedor)
- [ ] Canal ao vivo toca (hls.js em modo progressive → fetch → plugin http)
- [ ] Filme toca
