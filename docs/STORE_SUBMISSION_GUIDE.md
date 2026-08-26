# Guia de submissão — Samsung Tizen e LG webOS

Passo a passo prático de "onde eu clico" pra levar o Zapp TV das lojas —
Samsung Apps TV e LG Content Store. Não repete o que já está documentado
noutro lugar; só aponta pra lá na hora certa. Ver primeiro:

- `README.md` §"Samsung Tizen"/"LG webOS" — identidade do pacote, comandos
  exatos de empacotar/instalar (`tizen package`/`ares-package`).
- `.agents/smart-tv.md` §4 — a spec original de requisitos de plataforma
  (este guia é o "como fazer", aquele é o "o que é exigido").
- `docs/CHECKLIST_TIZEN.md` / `docs/CHECKLIST_WEBOS.md` — checklist técnico
  de D-pad/foco/inputs/player, rodar ANTES de empacotar.

## Onde as coisas estão hoje (2026-08)

Nenhuma das duas lojas tem conta criada ainda. `npm run build:tizen`/
`build:webos` já geram o build validado (type-check + CSS-compat + budget de
bundle) dentro de `tizen/`/`webos/`, prontos pra empacotar — mas empacotar
exige o CLI de cada SDK, que exige conta+certificado, que ainda não existem.
CI (`ci.yml`) faz o mesmo build+validação a cada push, nunca empacota nem
publica — é 100% humano a partir daqui, de propósito (certificado/assinatura
nunca deve entrar no repo — já reforçado em `.gitignore` e no README, seção
"Security Notes").

## Fase 0 — antes de mexer em qualquer loja

- [ ] **E-mail dedicado** pra essas contas (não o pessoal) — os dois
  portais mandam notificação de revisão nele, vale a pena não misturar.
- [ ] **Ícone/screenshots reais** — os placeholders de marca
  (`scripts/sync-brand.mjs`, `brand/`) precisam virar assets finais antes de
  tirar print de tela pra loja nenhuma (print com ícone de teste = rejeição
  ou re-submissão).
- [ ] **Decidir o texto de "o que é o app"** pras duas lojas AGORA, não na
  hora da submissão — reaproveite o disclaimer que já existe no topo do
  README (o app é só um player, não hospeda/fornece conteúdo, credenciais
  são do próprio usuário). As duas lojas perguntam alguma variação de
  "quem é dono do conteúdo" — essa é a resposta, palavra por palavra.
- [ ] Hardware físico Samsung E LG disponível — nenhuma das duas lojas aceita
  submissão testada só em emulador/simulador (`.agents/smart-tv.md` §4.1/4.2).

## Fase 1 — Samsung Tizen

### 1.1 Conta (fazer primeiro — pode levar dias pra aprovar)

1. Criar/usar uma Samsung Account em <https://account.samsung.com>.
2. Entrar em <https://seller.samsungapps.com> (Samsung Seller Office) e se
   inscrever como Seller — é uma aprovação SEPARADA da conta Samsung comum,
   não instantânea.
3. Por padrão, sellers públicos (sem parceria comercial) distribuem só nos
   EUA — se a meta for Brasil/outros países, isso exige contato comercial
   com a Samsung à parte (fora do escopo deste guia, é negociação, não
   configuração).

### 1.2 Certificado de distribuição

1. No Tizen Studio, abrir o **Certificate Manager**.
2. Gerar um certificado de **distribuição** vinculado ao Seller ID (Fase
   1.1) — é DIFERENTE do certificado de teste que você já deve ter usado
   pra rodar o app localmente via `sdb`. Sem esse certificado o pacote roda
   local mas a loja recusa.
3. Guardar o perfil (`-s <perfil>` no comando de `tizen package` do README)
   — nunca commitar (`.sign/`, `*.wgt` já estão no `.gitignore`).

### 1.3 Empacotar e pré-testar

```bash
npm run build:tizen   # valida + gera tizen/assets
```
Depois seguir o comando exato já documentado no README (`tizen package -t
wgt -s <perfil> ...`), instalar no dispositivo real via `sdb`, e rodar
`docs/CHECKLIST_TIZEN.md` inteiro nesse dispositivo físico antes de
submeter — a Samsung roda um **Pre-Test automático** na submissão que reprova
por exatamente esse tipo de coisa (foco perdido, teclado quebrado, memória).

### 1.4 Preparar os materiais da loja

- 4 screenshots JPEG, <500KB cada, 1280×720 ou 1920×1080 (nunca as duas
  misturadas no mesmo envio).
- Descrição curta + longa do app (reaproveitar o disclaimer, ver Fase 0).
- Categoria: Entretenimento/Vídeo (confirmar a taxonomia exata dentro do
  Seller Office na hora, ela muda ocasionalmente).
- Classificação etária — como o app não fornece conteúdo próprio (só
  conecta com credencial do usuário), a resposta de "conteúdo adulto" na
  submissão é sobre o APP em si (ele TEM um bloqueio de PIN pra categoria
  adulta — mencionar isso ajuda a classificação, não esconder).

### 1.5 Submeter

Fluxo no Seller Office: **Registration → Pre-Test automático (minutos) →
Certification/Verification manual (dias) → Release**. Se o Pre-Test
reprovar, ele aponta o motivo — geralmente algo do `CHECKLIST_TIZEN.md`
que passou despercebido; corrigir, rebuildar, resubmeter, sem precisar
reabrir conta nem certificado.

## Fase 2 — LG webOS

### 2.1 Conta (fazer primeiro — reservar o app id cedo)

1. Criar conta em <https://seller.lgappstv.com> (LG Seller Lounge).
   **Não ativar autenticação de dois fatores durante o cadastro** — é um
   problema conhecido do fluxo de criação de conta da LG (já registrado em
   `.agents/smart-tv.md` §4.2); ativar 2FA depois de a conta estar
   funcionando normalmente, se quiser.
2. Reservar o App ID de verdade assim que possível — o repo hoje usa
   `com.rakjsu.neostreamtv` como **placeholder** em `webos/appinfo.json`
   (confirmado no README). Depois de reservar o id real na Seller Lounge,
   atualizar esse campo (é o único lugar que precisa mudar — `vendor`/
   `title` podem ficar).

### 2.2 Empacotar e testar em hardware real

```bash
npm run build:webos   # valida + gera webos/assets
```
Depois `ares-package`/`ares-install`/`ares-launch` (comandos exatos já no
README, seção "LG webOS"). Usar `ares-inspect` pra DevTools remoto — de
novo, emulador não reproduz a RAM real do aparelho.

### 2.3 Preencher os DOIS documentos obrigatórios com resultado real

Isto é o que mais falta hoje e é o que MAIS demora — os dois arquivos já
existem como rascunho, cada um com o aviso "RASCUNHO — pendente de teste em
hardware webOS real — não submeter":

- **`docs/LG_UX_SCENARIO.md`** — descreve o fluxo de uso real do app
  (idioma → login → navegação → player), com prints de TELA REAL da TV.
  Tem uma seção "TODO" pra confirmar categoria da loja e testar o Magic
  Remote (ponteiro) além do D-pad — os controles LG modernos vêm com os
  dois, e um fluxo que só funciona com D-pad puro pode falhar com ponteiro.
- **`docs/LG_SELF_CHECKLIST.md`** — autoavaliação linha por linha
  (instalação, navegação, player...) — cada `[ ]` precisa virar `[x]` com
  base em teste FEITO, não em leitura de código. A LG rejeita
  automaticamente se perceber que é suposição, não teste.

Rodar `docs/CHECKLIST_WEBOS.md` primeiro (é o preparo técnico) e só depois
transcrever os resultados pros dois documentos de submissão acima — são
públicos-alvo diferentes (o CHECKLIST_WEBOS é pra você/equipe; os outros
dois são o que a LG lê).

### 2.4 Materiais da loja

- Screenshots 1280×720.
- Mesma descrição/disclaimer de conteúdo da Fase 0.
- Sem taxa de submissão (diferente da Samsung em alguns fluxos — confirmar
  a LG não mudou isso).

### 2.5 Submeter

Fluxo: **Submission → Testing (QA da própria LG) → Approval**. Sem taxa,
mas ciclo de revisão típico de **5–10 dias úteis**, e é comum precisar
**2–3 rodadas** de reenvio antes de aprovar — planejar prazo com folga,
principalmente se houver uma data de lançamento em mente.

## Depois de aprovado nas duas

- Atualizar o Roadmap do `README.md` (linha que hoje diz "the store listing
  itself is not live yet") e do `CHANGELOG.md`.
- Guardar os certificados/perfis de assinatura em backup SEGURO fora do
  repo (gerenciador de senhas da equipe, não um arquivo solto) — perdê-los
  significa não conseguir assinar uma atualização futura com a MESMA
  identidade, e a loja não deixa trocar de certificado de um app já
  publicado sem processo à parte.
- Daí em diante, toda nova versão repete só a Fase 1.3/1.5 (Samsung) e
  2.2/2.3/2.5 (LG) — a conta e o certificado/app-id já existem, não se
  refaz do zero.
