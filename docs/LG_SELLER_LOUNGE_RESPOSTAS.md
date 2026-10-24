# Respostas da LG Seller Lounge

Cola pra preencher os formulários da Seller Lounge (registro do app, rating,
privacidade, QA). A explicação está em português; o **texto pra colar** está em
inglês, porque é a língua do formulário e da QA da LG.

Regra de ouro: a resposta tem que bater com o que o app faz **de verdade**. A
QA da LG testa na TV, e uma resposta "otimista" que o teste desmente vira um
defeito a mais. Na dúvida, descreva o comportamento real.

Fatos do app em que as respostas se apoiam (conferidos no código em
2026-10-18; confira de novo se o app mudar):

- É **só player**: sem conteúdo próprio, sem lista/canal embutido, sem
  servidor nosso. Fala com o servidor Xtream que o **usuário** digita.
- **Sem conta nossa, sem backend, sem analytics/telemetria, sem anúncio, sem
  compra.** Nada sai do aparelho pra nós.
- Credenciais (servidor/usuário/senha do painel do usuário), favoritos,
  progresso, PIN e configurações ficam no `localStorage` da TV.
- Rede de terceiros, além do servidor do usuário:
  - TMDB (`api.themoviedb.org`, `image.tmdb.org`): **só** se o usuário
    colocar a chave TMDB dele em Configurações;
  - OpenSubtitles (`api.opensubtitles.com`): **só** com chave/conta do
    próprio usuário;
  - Google Fonts (`fonts.googleapis.com`/`fonts.gstatic.com`): fonte Inter;
  - YouTube: trailer, aberto pelo app do sistema na TV.
- Controle parental: perfil Kids, PIN e categorias adultas bloqueadas por PIN
  em todos os perfis (ver README, "Security Notes").
- Idiomas: português, inglês e espanhol.
- Alvo: webOS 4.x ou mais novo (TVs de 2018 em diante), 1920×1080.
- Licença MIT; dependência de player: HLS.js (Apache-2.0).

## 1. Informações do app

| Campo | Resposta |
|---|---|
| App name | `Zapp TV` |
| App ID | `com.tabica.zapptv` — tem que ser igual ao `id` de `webos/appinfo.json` |
| Version | igual ao `version` de `webos/appinfo.json` (e ao nome do `.ipk`) |
| Category | Entertainment (ou "Video", se existir) |
| Price | Free |
| In-app purchase / ads | No / No |
| Supported languages | English, Portuguese, Spanish |
| Resolution | 1920×1080 (FHD) |
| Input | D-pad do controle comum + Magic Remote (confira o ponteiro numa TV antes de afirmar) |

**Descrição curta**

> IPTV player for your own Xtream Codes subscription. No content included.

**Descrição longa**

> Zapp TV is a media player for LG webOS TVs. It plays live TV, movies and
> series from an IPTV service that the user already subscribes to, using the
> Xtream Codes login (server, username and password) provided by that
> service.
>
> Zapp TV does not provide, host, sell or distribute any channels, movies,
> series, playlists or streams. No content is included in the app. Users must
> have their own subscription and are responsible for the content they
> access through it.
>
> Features: live TV with program guide (EPG) and catch-up, movies and series
> with continue watching, favorites, global search, multiple playlists,
> Kids profile and PIN-protected parental control, and channel zapping with
> the remote's CH+/CH- and number keys.

**Palavras-chave:** `IPTV, player, Xtream, live TV, EPG, video player`.
Nunca use nome de canal, emissora, estúdio ou provedor: além de não ser nosso
conteúdo, é motivo clássico de rejeição.

## 2. Conteúdo e direitos

É a pergunta que mais pesa pra app de IPTV. A LG quer saber de quem é o
conteúdo e se o app facilita pirataria.

**"Does the app provide content? / Who owns the content?"**

> No. Zapp TV is a player only. It ships with no channels, playlists, URLs or
> media, and has no server of its own. It connects only to the Xtream Codes
> server that the user enters. The content and its licensing are the
> responsibility of the user's service provider.

**"Do you have the rights / licenses to the content?"**

> The app does not distribute content, so there is no content to license. It
> is comparable to a generic media player: the user supplies the source.

**"Is the app affiliated with any IPTV provider?"**

> No. Zapp TV is not affiliated with, and does not recommend or link to, any
> IPTV provider.

Não divulgue provedor em nenhum campo (descrição, print, nota pro testador):
o print com logo de canal ou nome de painel derruba o app como "conteúdo sem
direito". Os prints de `brand/webos/screenshots` precisam passar por esse
filtro também.

## 3. Conta de teste pra QA

Sem uma conta que funcione, o testador vê só a tela de login e reprova por
"funcionalidade não testável". Mande uma conta Xtream de teste **só no campo
da Seller Lounge** (nota pro testador / test account). Nunca no repositório,
em commit, em print ou em doc.

Cuidados:

- A conta do painel que usamos tem **1 conexão**: se alguém estiver vendo
  enquanto a LG testa, a QA leva erro de "limite" e reprova. Use uma conta
  separada pra QA, ou deixe a TV de casa desligada no período de teste.
- Ela tem que ficar válida durante todo o ciclo (5–10 dias úteis, às vezes
  2–3 rodadas). Conta que expira no meio do teste vira outro defeito.
- Evite conta com categorias adultas; se tiver, explique o PIN (abaixo).

**Nota pro testador (modelo)**

> Zapp TV requires the user's own Xtream Codes account. Test account:
> Server: `<server>` · Username: `<user>` · Password: `<password>`.
>
> On first launch: choose a language, then enter the three fields above and
> press Login. Navigation: arrow keys and OK; Back returns one screen (on the
> home screen it asks before exiting). In live TV, CH+/CH- and number keys
> change channels.
>
> The parental PIN, if asked, is `0000` (default; it can be changed in
> Settings > Parental control).
>
> The test account allows one simultaneous connection; please do not test on
> more than one TV at the same time.

## 4. Classificação etária

O app em si não tem conteúdo, mas o testador vai ver o que a conta de teste
mostrar. Responda pelo app e cite o controle parental:

- Violence / sexual content / language / drugs / gambling **in the app
  itself**: None.
- User-generated content / social / chat: No.
- Unrestricted internet access: o app só fala com o servidor configurado pelo
  usuário (não é navegador) — responda "No" se a pergunta for de navegador
  livre.

> The app contains no content of its own. Content comes from the user's own
> subscription. A Kids profile and a PIN lock for adult categories (enabled
> on every profile) are built in.

Se o formulário só permitir uma faixa, escolha a que a LG sugerir pra
"video player" e não a mais baixa possível: um rating baixo demais com IPTV é
outro defeito comum.

## 5. Privacidade e dados pessoais

**"Does the app collect personal information?"**

> The app stores, only on the TV, the login the user types for their own
> IPTV service (server, username, password), plus preferences, favorites,
> watch progress and the parental PIN. None of this is sent to the developer.
> There is no developer account, backend, analytics, tracking or advertising.
> The login is sent only to the server the user entered, to sign in.

**"Third-party services?"**

> Optional, only when the user enters their own API key: TMDB (movie and
> series metadata and images) and OpenSubtitles (subtitles). Google Fonts is
> used to load the app font. Trailers open in the TV's YouTube app.

**"How can the user delete data?"** Sair da playlist em Configurações apaga a
conta salva; desinstalar o app apaga tudo.

> Removing the playlist in Settings deletes its stored login. Uninstalling
> the app removes all stored data.

**Privacy policy URL:** a LG costuma exigir uma URL pública, mesmo pra app
que não coleta nada. Ainda não existe uma. O caminho mais simples é uma
página no GitHub Pages ou um `PRIVACY.md` no repositório público, com o
texto acima (é o comportamento real; não prometa nada além disso).

## 6. Técnico / pacote

| Pergunta | Resposta |
|---|---|
| SDK / CLI | `@webos-tools/cli` (versão do `npm run package:webos`; `ares-package -V`) — a LG manda instalar a última do npm |
| Minimum webOS | webOS 4.0 (2018 models) |
| Web app / native | Web app (`type: web`) |
| Uses DRM | No (plays the user's HLS/MPEG-TS streams) |
| Encryption / export | Only standard HTTPS from the platform; no own cryptography |
| Open source | MIT; uses React, HLS.js (Apache-2.0) and other MIT libraries |
| Background / autostart | No |

Antes de enviar o `.ipk`, confira:

- `iconColor` de `webos/appinfo.json` = cor do fundo de `icon.png` e
  `largeIcon.png` (gerados juntos por `npm run brand:icons`; rejeição de
  2026-10-12, defeito "Appicon background color and tile color do not
  match").
- O `.ipk` foi gerado por `npm run package:webos`, não à mão nem com o CLI
  antigo "webOS TV" (defeito "Not the officially released SDK version" na
  mesma rejeição).
- Versão no `appinfo.json`, no nome do `.ipk` e no formulário são a mesma.
- `docs/LG_SELF_CHECKLIST.md` e `docs/LG_UX_SCENARIO.md` preenchidos com
  teste de verdade (ver `docs/STORE_SUBMISSION_GUIDE.md` §2.3).

### Tela File Upload

O App ID (`com.tabica.zapptv`) já está confirmado e não muda. Pra trocar o
`.ipk`, use **Modify** na linha do arquivo existente (ou **File Re-Upload**):
não crie uma linha nova com **File Upload**, senão ficam dois pacotes "Main".

| Campo | Valor |
|---|---|
| Service Platforms | webOS (NetCast não: é a plataforma das TVs anteriores a 2014) |
| Type | Main |
| Chipset | All |
| File | `dist/ipk/com.tabica.zapptv_<versão>_all.ipk` |
| Service Platform / SDK Ver | o SDK vem do **ano da plataforma** escolhido. Marque de **webOS 4.0 (TVs 2018)** até o ano mais novo **já lançado**. Não marque 2017 ou antes (webOS 3.x, Chromium 38: o bundle não roda lá) nem ano ainda não lançado/beta (suspeito do defeito "Not the officially released SDK version") |
| Resolution | 1920×1080 |
| File Ver | a versão do `appinfo.json`; **não pode ser menor** que nenhuma já enviada (1.1.4 já foi) |
| Deep Link | vazio (o app não trata deep link) |

A própria tela sugere mandar também um pacote 1280×720 pra TVs HD. Não
precisa: o app é um só, em 1920×1080, e a TV HD reduz a escala. A nota em
vermelho só avisa que um pacote **apenas** em 1280×720 fica feio em TV Full HD.

### Tela Images

| Campo | Arquivo |
|---|---|
| App Icon Image (≥ 400×400, quadrado, **fundo sem gradiente**) | `brand/webos/store-icon-1024.png` (fundo sólido `#2563eb`) |
| App Tile Color | `#2563eb`, igual ao fundo do ícone e ao `iconColor` |
| Screenshots (mín. 3, 1920×1080 ou 1280×720) | `brand/webos/screenshots/store_*.jpg` |
| Splash Screen Background (1920×1080) | `brand/webos/splash.png` |

Os `screenshot_*.png` da mesma pasta não servem: têm ~2500×860. Os prints
mostram só idioma, login e o aviso "apenas um player", sem canal, logo ou
painel. Se o app for listado fora do Brasil, vale refazê-los em inglês.

## 7. Responder defeito de QA

Pra cada Issue ID reprovado, a Seller Lounge pede o que mudou. Curto,
concreto, com a versão:

> **QA2026101224332** (Appicon background color and tile color do not
> match): the icon background is now a solid color identical to
> `iconColor` in appinfo.json (#2563eb). Fixed in version X.Y.Z.
>
> **QA2026101224333** (Not the officially released SDK version): the package
> is now built with the current official webOS CLI (`@webos-tools/cli`
> 3.2.6, installed from npm as instructed on webostv.developer.lge.com).
> Fixed in version X.Y.Z.

Se a LG insistir no item do SDK com o pacote novo, pergunte qual versão de
CLI/SDK eles esperam. Não dá pra deduzir isso daqui.

## 8. Suporte

| Campo | Resposta |
|---|---|
| Support e-mail | o e-mail dedicado da conta (Fase 0 do `STORE_SUBMISSION_GUIDE.md`) |
| Website / support URL | repositório público ou página de releases no GitHub |

Pergunta que não está aqui: responda pelo mesmo princípio (só player, nada
sai da TV pra nós, conteúdo é do usuário) e acrescente a pergunta e a
resposta neste arquivo.
