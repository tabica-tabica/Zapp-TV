// Welcome Page - Premium design from original app (without settings button)
import { useRef, useEffect } from 'react';
import { FaPlus, FaStar, FaExclamationTriangle } from 'react-icons/fa';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useTranslation } from '../hooks/useTranslation';
import { BrandLogo } from '../components/BrandLogo';
import './Welcome.css';

interface WelcomeProps {
    onGoToLogin: () => void;
}

export function Welcome({ onGoToLogin }: WelcomeProps) {
    const { t } = useTranslation();
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Focus the button on mount
    useEffect(() => {
        // Small delay to ensure DOM is ready
        const timer = setTimeout(() => {
            buttonRef.current?.focus();
        }, 100);
        return () => clearTimeout(timer);
    }, []);

    useTVNavigation({
        onEnter: () => {
            onGoToLogin();
        },
    });

    const handleClick = () => {
        onGoToLogin();
    };

    return (
        <div className="welcome-container">
            {/* Animated Background */}
            <div className="welcome-bg">
                <div className="welcome-orb welcome-orb-1" />
                <div className="welcome-orb welcome-orb-2" />
                <div className="welcome-orb welcome-orb-3" />
                <div className="welcome-glow-sweep" />
                <div className="welcome-grid" />
                <div className="welcome-vignette" />
            </div>

            {/* Content */}
            <div className="welcome-content">
                {/* Logo Section */}
                <div className="welcome-logo">
                    <div className="welcome-logo-bg">
                        <BrandLogo size={44} className="welcome-logo-icon" />
                    </div>
                    <h1 className="welcome-title">{__BRAND_NAME__}</h1>
                    <div className="welcome-badge">
                        <FaStar size={12} />
                        <span style={{ marginLeft: '6px' }}>{t('welcome_subtitle')}</span>
                    </div>
                </div>

                {/* Message */}
                <div className="welcome-message">
                    <h2>{t('welcome_no_playlist')}</h2>
                    <p>{t('welcome_add_instruction')}</p>
                </div>

                {/* Action Card - Always focused since it's the only button */}
                <div className="welcome-cards">
                    <button
                        ref={buttonRef}
                        className="welcome-card welcome-card-primary focused"
                        onClick={handleClick}
                        tabIndex={1}
                        autoFocus
                    >
                        <div className="welcome-card-icon">
                            <FaPlus size={24} />
                        </div>
                        <div className="welcome-card-text">
                            <span className="welcome-card-title">{t('welcome_login_button')}</span>
                            <span className="welcome-card-desc">{t('welcome_login_desc')}</span>
                        </div>
                    </button>
                </div>

                {/* Legal use notice */}
                <div className="welcome-legal-notice">
                    <FaExclamationTriangle size={16} className="welcome-legal-notice-icon" />
                    <p>{t('welcome_legal_notice')}</p>
                </div>

                {/* Footer */}
                <p className="welcome-footer">
                    {t('welcome_disclaimer')}
                </p>

                {/* Navigation hint for TV */}
                <div className="welcome-hint">
                    <span>{t('welcome_hint')}</span>
                </div>
            </div>
        </div>
    );
}
