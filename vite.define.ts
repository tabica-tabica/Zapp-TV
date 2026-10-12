// vite.define.ts — monta o bloco `define` compartilhado pelos 4
// vite.*.config.ts (versão + alvo de build + marca), num lugar só, pra não
// repetir os mesmos ~13 campos em cada arquivo. Ver brand.config.mjs.
import pkg from './package.json'
import brand from './brand.config.mjs'

export function brandDefine(target: 'web' | 'tizen' | 'webos' | 'tauri') {
  return {
    // Versao exposta no bundle: a tela de diagnostico (item 59) precisa
    // dizer qual build esta rodando na TV
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TARGET__: JSON.stringify(target),
    __BRAND_NAME__: JSON.stringify(brand.name),
    __BRAND_FULL_NAME__: JSON.stringify(brand.fullName),
    __BRAND_TAGLINE__: JSON.stringify(brand.tagline),
    __BRAND_ACCENT_HEX__: JSON.stringify(brand.accent.hex),
    __BRAND_ACCENT_RGB__: JSON.stringify(brand.accent.rgb),
    __BRAND_ACCENT2_HEX__: JSON.stringify(brand.accent2.hex),
    __BRAND_ACCENT2_RGB__: JSON.stringify(brand.accent2.rgb),
    __BRAND_ACCENT3_HEX__: JSON.stringify(brand.accent3.hex),
    __BRAND_ACCENT3_RGB__: JSON.stringify(brand.accent3.rgb),
    __BRAND_ACCENT4_HEX__: JSON.stringify(brand.accent4.hex),
    __BRAND_ACCENT4_RGB__: JSON.stringify(brand.accent4.rgb),
    __BRAND_FONT_FAMILY__: JSON.stringify(brand.font.family),
    __BRAND_FONT_WEIGHTS__: JSON.stringify(brand.font.googleWeights),
    __BRAND_LOGO_URL__: JSON.stringify(brand.logoUrl || ''),
  }
}

// TVs: build "light" do hls.js (−188 KB, ~1/3 dele). Fica de fora o que estes
// builds não usam: faixas ALTERNATIVAS de áudio/legenda dentro de stream HLS
// (filme e série do Xtream são mp4/mkv direto, com as faixas do próprio
// <video>; canal ao vivo vem com uma faixa só), DRM, CMCD, content steering,
// interstitials e #EXT-X-DEFINE. O desktop segue com o build completo.
// Só o import "hls.js" exato: o do worker (hls.js/dist/hls.worker.js) é o mesmo nos dois.
export const hlsLightNaTV = [{ find: /^hls\.js$/, replacement: 'hls.js/light' }]
