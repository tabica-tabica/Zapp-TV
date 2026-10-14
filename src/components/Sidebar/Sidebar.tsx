// Sidebar Navigation Component - Matching NeoStream Desktop Design

import { useState, useMemo } from 'react';
import type { IconType } from 'react-icons';
import {
    FaSearch, FaHome, FaBroadcastTower, FaFilm, FaTv, FaBookmark, FaCog,
    FaUserCircle, FaSignOutAlt, FaSync,
} from 'react-icons/fa';
import { useTVNavigation } from '../../hooks/useTVNavigation';
import { useFocusZone } from '../../contexts/FocusContext';
import { useTranslation } from '../../hooks/useTranslation';
import type { TranslationKey } from '../../i18n';
import { reloadActivePlaylist } from '../../services/reloadPlaylist';
import { contentFlags } from '../../services/contentFlags';
import { BrandLogo } from '../BrandLogo';
import './Sidebar.css';

interface SidebarProps {
    activeItem: string;
    onItemSelect: (itemId: string) => void;
    onLogout: () => void;
    onProfileClick: () => void;
    /** Voltar com a sidebar focada: sobe um degrau (página → Home → sair) */
    onBack?: () => void;
    focused?: boolean;
}

interface MenuItem {
    id: string;
    label: string;
    icon: IconType;
    gradient: string;
    requiresTV?: boolean;
    requiresVOD?: boolean;
}

const allMenuItems: MenuItem[] = [
    { id: 'search', label: 'Buscar', icon: FaSearch, gradient: 'linear-gradient(135deg, #64748b, #475569)' },
    { id: 'home', label: 'Início', icon: FaHome, gradient: 'linear-gradient(135deg, #f59e0b, #d97706)' },
    { id: 'live', label: 'TV ao Vivo', icon: FaBroadcastTower, gradient: 'linear-gradient(135deg, #2563eb, #1e3a8a)', requiresTV: true },
    { id: 'movies', label: 'Filmes', icon: FaFilm, gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', requiresVOD: true },
    { id: 'series', label: 'Séries', icon: FaTv, gradient: 'linear-gradient(135deg, #22d3ee, #0891b2)', requiresVOD: true },
    { id: 'mylist', label: 'Minha Lista', icon: FaBookmark, gradient: 'linear-gradient(135deg, #14b8a6, #0891b2)' },
    { id: 'settings', label: 'Configurações', icon: FaCog, gradient: 'linear-gradient(135deg, #6b7280, #4b5563)' },
];

export function Sidebar({ activeItem, onItemSelect, onLogout, onProfileClick, focused = false , onBack}: SidebarProps) {
    const { setFocusZone } = useFocusZone();
    const { t } = useTranslation();

    // Get include preferences from localStorage
    const includeTV = contentFlags.includeTV();
    const includeVOD = contentFlags.includeVOD();

    // Filter menu items based on preferences
    const menuItems = useMemo(() => {
        return allMenuItems.filter(item => {
            if (item.requiresTV && !includeTV) return false;
            if (item.requiresVOD && !includeVOD) return false;
            return true;
        });
    }, [includeTV, includeVOD]);

    const [focusedIndex, setFocusedIndex] = useState(
        menuItems.findIndex(item => item.id === activeItem)
    );
    const [hoveredItem, setHoveredItem] = useState<string | null>(null);
    // "Sair" apaga a playlist e a conta do aparelho: pede um 2º OK. Um ↓ a
    // mais no menu (o foco lembrava o botão Perfil) caía nele e um OK só
    // deslogava a TV (visto em 14/10/2026). Mover o foco desarma.
    const [sairArmado, setSairArmado] = useState(false);
    const sair = () => {
        if (sairArmado) onLogout();
        else setSairArmado(true);
    };

    const handleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
        setSairArmado(false);
        if (direction === 'up') {
            setFocusedIndex(prev => Math.max(0, prev - 1));
        } else if (direction === 'down') {
            setFocusedIndex(prev => Math.min(menuItems.length + 2, prev + 1)); // +1 recarregar, +1 perfil, +1 sair
        } else if (direction === 'right') {
            // Move focus to content area
            setFocusZone('content');
        }
    };

    const handleEnter = () => {
        if (focusedIndex === menuItems.length + 2) {
            // Logout button
            sair();
        } else if (focusedIndex === menuItems.length + 1) {
            // Profile button - open profile manager
            onProfileClick();
        } else if (focusedIndex === menuItems.length) {
            // Recarregar lista - limpa o cache e recarrega o app
            reloadActivePlaylist();
        } else {
            const item = menuItems[focusedIndex];
            if (item) {
                onItemSelect(item.id);
                // 'search' abre o overlay (zona 'overlay' setada pelo App) —
                // forcar 'content' aqui reativaria a pagina atras da busca
                if (item.id !== 'search') {
                    setFocusZone('content'); // Move to content after selecting
                }
            }
        }
    };

    // Only enable TV navigation when sidebar is focused
    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onBack: onBack && (() => { setSairArmado(false); onBack(); }),
        enabled: focused,
    });

    return (
        <>
            <div className={`sidebar ${focused ? 'sidebar-focused' : ''}`}>
                {/* Animated Background */}
                <div className="sidebar-bg">
                    <div className="bg-gradient" />
                    <div className="bg-glow" />
                </div>

                {/* Logo */}
                <div className="logo-container">
                    <div className="logo-wrapper">
                        <BrandLogo size={44} />
                    </div>
                </div>

                {/* Navigation */}
                <nav className="nav-container">
                    {menuItems.map((item, index) => {
                        const isActive = activeItem === item.id;
                        const isFocused = focused && focusedIndex === index;
                        const isHovered = hoveredItem === item.id;

                        return (
                            <button
                                key={item.id}
                                onClick={() => onItemSelect(item.id)}
                                onMouseEnter={() => setHoveredItem(item.id)}
                                onMouseLeave={() => setHoveredItem(null)}
                                onFocus={() => setFocusedIndex(index)}
                                className={`nav-item ${isActive ? 'active' : ''} ${isFocused ? 'tv-focused' : ''}`}
                                style={{ animationDelay: `${index * 0.05}s` }}
                                data-focusable="true"
                            >
                                {/* Background Glow */}
                                <div
                                    className="item-glow"
                                    style={{
                                        background: item.gradient,
                                        opacity: isActive ? 0.25 : isFocused || isHovered ? 0.15 : 0
                                    }}
                                />

                                {/* Icon */}
                                <div className="item-icon-wrapper">
                                    <span className="item-icon"><item.icon /></span>
                                </div>

                                {/* Active Indicator */}
                                {isActive && (
                                    <div className="active-indicator">
                                        <div className="indicator-bar" style={{ background: item.gradient }} />
                                    </div>
                                )}

                                {/* Tooltip */}
                                <div className={`tooltip ${isFocused || isHovered ? 'visible' : ''}`}>
                                    <span className="tooltip-emoji"><item.icon /></span>
                                    <span className="tooltip-label">{t(`sidebar_${item.id}` as TranslationKey)}</span>
                                </div>
                            </button>
                        );
                    })}
                </nav>

                {/* Bottom Section */}
                <div className="bottom-section">
                    {/* Recarregar lista */}
                    <button
                        className={`reload-btn ${focused && focusedIndex === menuItems.length ? 'tv-focused' : ''}`}
                        onClick={reloadActivePlaylist}
                        onMouseEnter={() => setHoveredItem('reload')}
                        onMouseLeave={() => setHoveredItem(null)}
                        onFocus={() => setFocusedIndex(menuItems.length)}
                        data-focusable="true"
                    >
                        <FaSync className="reload-icon" size={20} />
                        <div className={`tooltip ${(focused && focusedIndex === menuItems.length) || hoveredItem === 'reload' ? 'visible' : ''}`}>
                            <span className="tooltip-emoji"><FaSync /></span>
                            <span className="tooltip-label">Recarregar lista</span>
                        </div>
                    </button>

                    {/* Profile Button */}
                    <button
                        className={`profile-btn ${focused && focusedIndex === menuItems.length + 1 ? 'tv-focused' : ''}`}
                        onClick={onProfileClick}
                        onMouseEnter={() => setHoveredItem('profile')}
                        onMouseLeave={() => setHoveredItem(null)}
                        onFocus={() => setFocusedIndex(menuItems.length + 1)}
                        data-focusable="true"
                    >
                        <div className="profile-ring" />
                        <div className="profile-inner">
                            <svg width="26" height="26" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                                <defs>
                                    <linearGradient id="profileGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" stopColor={__BRAND_ACCENT_HEX__} />
                                        <stop offset="100%" stopColor={__BRAND_ACCENT4_HEX__} />
                                    </linearGradient>
                                </defs>
                                <circle cx="50" cy="35" r="14" fill="none" stroke="url(#profileGrad)" strokeWidth="6" />
                                <path d="M 20,85 C 20,65 30,55 50,55 C 70,55 80,65 80,85" fill="none" stroke="url(#profileGrad)" strokeWidth="6" strokeLinecap="round" />
                            </svg>
                        </div>
                        {/* Profile Tooltip */}
                        <div className={`tooltip ${(focused && focusedIndex === menuItems.length + 1) || hoveredItem === 'profile' ? 'visible' : ''}`}>
                            <span className="tooltip-emoji"><FaUserCircle /></span>
                            <span className="tooltip-label">{t('sidebar_profile' as TranslationKey)}</span>
                        </div>
                    </button>

                    {/* Logout */}
                    <button
                        className={`logout-btn ${focused && focusedIndex === menuItems.length + 2 ? 'tv-focused' : ''}`}
                        onClick={sair}
                        onMouseEnter={() => setHoveredItem('logout')}
                        onMouseLeave={() => { setHoveredItem(null); setSairArmado(false); }}
                        onFocus={() => setFocusedIndex(menuItems.length + 2)}
                        data-focusable="true"
                    >
                        <svg className="logout-icon" viewBox="0 0 24 24" fill="none" width="22" height="22">
                            <path d="M9 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            <path d="M16 17L21 12L16 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                        {/* Logout Tooltip */}
                        <div className={`tooltip danger ${(focused && focusedIndex === menuItems.length + 2) || hoveredItem === 'logout' || sairArmado ? 'visible' : ''}`}>
                            <span className="tooltip-emoji"><FaSignOutAlt /></span>
                            <span className="tooltip-label">{t(sairArmado ? 'sidebar_logout_confirm' : 'sidebar_logout')}</span>
                        </div>
                    </button>
                </div>
            </div>
        </>
    );
}
