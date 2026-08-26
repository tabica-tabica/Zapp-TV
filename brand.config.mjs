// brand.config.mjs — ÚNICO lugar pra trocar nome, cor, fonte e ícone do app.
//
// `fullName` é a fonte de verdade do nome; as outras grafias que o app precisa
// (kebab-case pro <title> web, sem espaço pros manifests de Tizen/webOS) são
// DERIVADAS por scripts/sync-brand.mjs — não digite variações à mão em nenhum
// outro arquivo.
//
// Depois de editar este arquivo:
//   node scripts/sync-brand.mjs      # aplica nome nos 3 HTML + 3 manifests de plataforma
//   node scripts/generate-icons.mjs  # gera os ícones de cada plataforma a partir de iconSource
// As duas cores (accent/accent2/accent3) também precisam ser copiadas à mão pra
// src/index.css e src/services/themeService.ts — CSS/tipos estáticos não leem
// este arquivo em runtime, só o Vite `define` injeta os valores no bundle
// (ver __BRAND_* em src/vite-env.d.ts). Comentários nesses dois arquivos
// apontam de volta pra cá.
export default {
    // Forma curta: telas de boot, badges, tooltip da sidebar.
    name: 'Zapp',
    // Forma completa: rodapé da Home, título da janela desktop (Tauri),
    // launcher tile do Tizen/webOS. As grafias derivadas (kebab, sem espaço)
    // vêm SEMPRE desta string — não crie uma terceira variante solta.
    fullName: 'Zapp TV',
    // Badge do Login/Welcome, abaixo do logo.
    tagline: 'Streaming Player',

    // Cor de destaque principal — já dinâmica hoje via Configurações > Aparência
    // (themeService.ts), isto só define o valor PADRÃO antes do usuário escolher.
    accent: { hex: '#2563eb', rgb: '37, 99, 235' },
    // Cor secundária (gradientes de 2 pontas: botões, indicadores).
    accent2: { hex: '#0284c7', rgb: '2, 132, 199' },
    // Terceira cor (gradientes de 3 pontas: modais, overlays de destaque).
    accent3: { hex: '#0ea5e9', rgb: '14, 165, 233' },
    // Quarta cor (fecha alguns gradientes de 3+ pontas — logo da sidebar,
    // ContentDetailModal — e é a opção "Destaque" do picker de tema,
    // themeService.ts's ACCENTS.rosa). O ciano mais claro da família, pra
    // sobrar contraste vibrante contra as outras três, mais escuras.
    accent4: { hex: '#22d3ee', rgb: '34, 211, 238' },

    font: { family: 'Inter', googleWeights: '300..900' },

    // Opcional: caminho pra uma imagem de logo de verdade (ex.: '/brand/logo.svg',
    // servido de public/). Vazio = usa o SVG vetorial embutido em BrandLogo.tsx,
    // recolorido pelas cores acima. Só preencha se for trocar a MARCA inteira,
    // não só a cor.
    logoUrl: '',

    // Fonte VETORIAL do ícone (brand/logo-source.svg) — mesma marca do
    // BrandLogo.tsx, com {{ACCENT}}/{{ACCENT2}} no lugar da cor. Em cada
    // `npm run brand:icons`, scripts/generate-icons.mjs troca esses tokens
    // pelas cores abaixo e rasteriza pra `iconSource` — o PNG-base fica
    // sempre em dia com a cor da marca, sem precisar redesenhar nada à mão.
    // Vazio = pula esse passo (uso o `iconSource` já existente como está).
    logoSource: 'brand/logo-source.svg',
    // PNG-base pros ícones de cada plataforma (1024×1024, fundo não-
    // transparente — o Tizen/webOS não compõem alpha na home screen). Gerado
    // a partir de `logoSource` quando ele existe; scripts/generate-icons.mjs
    // lê este caminho (relativo à raiz do repo) e produz todo o resto:
    // favicon web, tizen/icon.png, webos/icon.png + largeIcon.png, e o
    // conjunto do Tauri via `tauri icon`. Só preencha um PNG à mão aqui (e
    // apague/deixe `logoSource` vazio) se for usar uma imagem pronta em vez
    // da marca vetorial.
    iconSource: 'brand/icon-source.png',
};
