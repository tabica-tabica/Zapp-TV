# Instalar o Zapp TV na TV LG pelo celular (Android + Termux)

Pra quem não tem computador: o celular Android faz o papel do instalador
(`install-tv.command`), pelo mesmo caminho do computador — Key Server na porta
9991 e SSH na 9922. Leva uns 10 minutos.

## Antes de começar, no celular

- **Mesmo Wi-Fi da TV.** Wi-Fi de visitante não serve: ele isola os aparelhos.
  Desligue também "Alternar para dados móveis" (Wi-Fi → ⋮ → Avançado), senão o
  celular pode cair pro 4G no meio da instalação.
- **VPN desligada** (Tailscale, VPN de operadora, etc.): ela pode impedir o
  celular de enxergar a TV no Wi-Fi.
- **Samsung: Bloqueador automático desligado** (Configurações → Segurança e
  privacidade → Bloqueador automático). Ele impede instalar o Termux fora da
  Play Store; pode religar depois.

## 1. Preparar a TV (uma vez só)

1. Na TV, abra a **LG Content Store**, procure **Developer Mode** e instale.
2. Abra o Developer Mode e entre com uma conta de desenvolvedor LG (gratuita,
   em webostv.developer.lge.com).
3. Ligue **Dev Mode Status**. A TV reinicia.
4. Abra o Developer Mode de novo e ligue **Key Server**.
5. Anote o **IP** e a **Passphrase** (6 letras) que aparecem na tela.

## 2. Instalar o Termux no celular

1. No navegador do celular, abra <https://f-droid.org/packages/com.termux/>.
2. Toque em **Baixar APK** na versão mais recente e instale. Se pedir, permita
   "instalar apps de fontes desconhecidas" pro navegador.

> ⚠️ Não use o Termux da Play Store: está desatualizado e não funciona.

## 3. Instalar o app na TV

Abra o Termux e digite um comando por vez, apertando Enter depois de cada um.
Se aparecer alguma pergunta, aperte Enter.

```sh
pkg update -y && pkg install -y openssh curl unzip
```

Baixa o pacote da TV LG da última versão:

```sh
cd ~ && curl -fsL https://api.github.com/repos/tabica-tabica/Zapp-TV/releases/latest | grep -o 'https://[^"]*zapp-tv-lg-[^"]*\.zip' | xargs curl -fLo zapp.zip
```

```sh
unzip -o zapp.zip -d zapp && cd zapp
```

Troque `IP-DA-TV` pelo IP anotado no passo 1 (ex.: `192.168.0.20`):

```sh
sh install-tv.command *.ipk IP-DA-TV
```

Quando pedir, digite a **Passphrase** da tela da TV. Em alguns segundos aparece
**"Pronto!"** e o app abre na TV.

## Achar a TV na rede

O IP aparece no app Developer Mode e em Configurações → Rede → Wi-Fi →
Configurações avançadas, na TV. O do celular fica em Configurações → Wi-Fi →
⚙️ da rede conectada. Os **três primeiros números** dos dois têm que ser iguais
(ex.: `192.168.0.20` e `192.168.0.35`); se não forem, estão em redes diferentes.

Testar se o celular enxerga a TV (com o Key Server ligado):

```sh
curl -m 5 -so /dev/null http://IP-DA-TV:9991/webos_rsa && echo OK || echo "não achei a TV"
```

Sem saber o IP: procura em toda a rede a TV com o Key Server ligado. Troque
`192.168.0` pelos três primeiros números do IP do celular; leva uns segundos:

```sh
for i in $(seq 1 254); do (curl -m 3 -so /dev/null http://192.168.0.$i:9991/webos_rsa && echo "TV: 192.168.0.$i") & done; wait
```

Não apareceu nada? O Key Server está desligado, a TV está em outra rede ou o
roteador isola os aparelhos (comum em Wi-Fi de visitante ou mesh com
"isolamento de clientes" ligado).

## Depois

- **A sessão do Developer Mode dura ~50 horas.** Abra o Developer Mode na TV de
  vez em quando e toque em **Extend**; se a sessão acabar, a TV apaga o Zapp.
  Pra reinstalar, ligue de novo e repita o passo 3.
- Pra atualizar o Zapp, repita o passo 3 — ele baixa a versão mais nova.

## Problemas

| Mensagem | O que fazer |
|---|---|
| Não consegui falar com o Key Server da TV | Confira o IP, se o **Key Server** está ligado e se celular e TV estão no mesmo Wi-Fi. |
| A Passphrase não confere com a da TV | Digite a que está na tela agora (ela muda a cada sessão). |
| `curl: (6) Could not resolve host` | Celular sem internet; confira o Wi-Fi. |
| `pkg` com erro de repositório | Rode `termux-change-repo`, escolha qualquer espelho e repita. |
