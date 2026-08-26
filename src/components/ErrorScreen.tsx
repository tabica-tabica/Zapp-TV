// Tela de erro de carregamento, navegável pelo controle.
//
// As três páginas de catálogo tinham cada uma a sua, e em todas o botão
// "Tentar novamente" só tinha `onClick`: numa TV sem mouse, o usuário via um
// botão bem visível que nenhuma tecla apertava. O único caminho de saída era
// adivinhar que ← leva à sidebar.

import type { IconType } from 'react-icons';
import { FaSync } from 'react-icons/fa';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useFocusZone } from '../contexts/FocusContext';
import './ErrorScreen.css';

interface ErrorScreenProps {
    /** Ícone que identifica a área (FaFilm filmes, FaTv séries…) */
    icon: IconType;
    title: string;
    message: string;
    /** Classe do container da página, pra manter o fundo de cada seção */
    className?: string;
    /** Padrão: recarrega o app inteiro */
    onRetry?: () => void;
}

export function ErrorScreen({ icon: Icon, title, message, className = '', onRetry }: ErrorScreenProps) {
    const { focusZone, setFocusZone } = useFocusZone();

    const retry = onRetry ?? (() => window.location.reload());

    useTVNavigation({
        onEnter: retry,
        // Voltar e ← devolvem o foco pra sidebar: sem isso a tela de erro é um
        // beco sem saída, porque a página por baixo não tem mais nada focável
        onBack: () => setFocusZone('sidebar'),
        onNavigate: (direction) => {
            if (direction === 'left') setFocusZone('sidebar');
        },
        enabled: focusZone === 'content',
    });

    return (
        <div className={`error-screen ${className}`}>
            <div className="error-screen-glow" />
            <div className="error-screen-content">
                <div className="error-screen-icon"><Icon /></div>
                <h2>{title}</h2>
                <p className="error-screen-message">{message}</p>
                <button
                    className={`error-screen-retry ${focusZone === 'content' ? 'tv-focused' : ''}`}
                    onClick={retry}
                >
                    <FaSync /> Tentar novamente
                </button>
                <p className="error-screen-hint">OK tenta de novo · ← ou Voltar abre o menu</p>
            </div>
        </div>
    );
}
