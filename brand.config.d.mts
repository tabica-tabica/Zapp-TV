// Declaração de tipos pra brand.config.mjs — o próprio arquivo fica em .mjs
// de propósito (scripts/*.mjs importam ele direto com `node`, sem TypeScript
// no meio); isto só existe pra vite.define.ts conseguir importá-lo tipado.
interface BrandColor {
    hex: string;
    rgb: string;
}

interface BrandConfig {
    name: string;
    fullName: string;
    tagline: string;
    accent: BrandColor;
    accent2: BrandColor;
    accent3: BrandColor;
    accent4: BrandColor;
    font: { family: string; googleWeights: string };
    logoUrl: string;
    logoSource: string;
    iconSource: string;
}

declare const brand: BrandConfig;
export default brand;
