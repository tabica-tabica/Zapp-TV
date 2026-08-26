// Legenda de tecla colorida do controle remoto (🔴🟢🟡🔵) — um componente só,
// reaproveitado em todo rodapé de dica. Cor explícita via style: nem todo
// arquivo que usava o emoji tinha uma classe .hint-* com cor de verdade (a
// maioria dependia só da cor própria do emoji, que agora vira ícone mono).

import { FaCircle } from 'react-icons/fa';

export type RemoteHintColor = 'red' | 'green' | 'yellow' | 'blue';

const COLORS: Record<RemoteHintColor, string> = {
    red: '#f87171',
    green: '#4ade80',
    yellow: '#facc15',
    blue: '#60a5fa',
};

interface RemoteColorHintProps {
    color: RemoteHintColor;
    label: string;
    className?: string;
}

export function RemoteColorHint({ color, label, className }: RemoteColorHintProps) {
    return (
        <span className={`hint-${color}${className ? ` ${className}` : ''}`}>
            <FaCircle style={{ color: COLORS[color], marginRight: 6, fontSize: '0.7em' }} />
            {label}
        </span>
    );
}
