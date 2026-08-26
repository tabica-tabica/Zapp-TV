// Logo único do app — ANTES havia 3 tratamentos visuais independentes
// (Sidebar.tsx tinha a marca de verdade; Login/Welcome usavam um ícone FaTv
// genérico num badge; App.tsx/LanguageSelection.tsx usavam um SVG de monitor
// sem relação nenhuma com os outros dois). Agora todo mundo importa daqui —
// trocar a cor (brand.config.mjs) ou a marca inteira (__BRAND_LOGO_URL__)
// muda em todo lugar de uma vez.

interface BrandLogoProps {
    size?: number;
    className?: string;
}

export function BrandLogo({ size = 44, className }: BrandLogoProps) {
    if (__BRAND_LOGO_URL__) {
        return (
            <img
                src={__BRAND_LOGO_URL__}
                alt={__BRAND_NAME__}
                width={size}
                height={size}
                className={className}
            />
        );
    }

    return (
        <svg
            className={`logo-svg${className ? ` ${className}` : ''}`}
            width={size}
            height={size}
            viewBox="0 0 100 100"
            xmlns="http://www.w3.org/2000/svg"
        >
            {/* "Z" como fita dobrada: 3 painéis retos (sem cantos arredondados,
                sem stroke — tudo preenchido), mais 2 cunhas escuras translúcidas
                exatamente onde um painel passa por cima do outro. A ordem de
                desenho FAZ a dobra: a diagonal é pintada depois da barra de
                cima (parece passar por cima dela), e a barra de baixo é
                pintada por último (passa por cima da diagonal). Painéis em
                branco — não nos tons de azul da marca — porque o badge que
                envolve o logo (.welcome-logo-bg etc.) já É um gradiente azul;
                um "Z" azul-sobre-azul perdia contraste. Os dois cantos que
                sobram pra fora (canto superior direito da barra de cima,
                canto inferior esquerdo da barra de baixo) são cortados em
                diagonal — a barra E a fita que passa por baixo dela são
                cortadas no MESMO ponto, senão a fita não aparada furava o
                corte da barra. Mesmas coordenadas 0-100 de
                brand/logo-source.svg. */}
            <polygon points="14,14 72,14 86,28 86,32 14,32" fill="#ffffff" />
            <polygon points="86,28 72,14 62,14 14,72 28,86 38,86" fill="#ffffff" />
            <polygon points="14,68 86,68 86,86 28,86 14,72" fill="#ffffff" />
            <polygon points="62,14 72,14 86,28 74,32 50,32" fill="#000000" opacity="0.18" />
            <polygon points="26,68 50,68 38,86 28,86 14,72" fill="#000000" opacity="0.18" />
        </svg>
    );
}
