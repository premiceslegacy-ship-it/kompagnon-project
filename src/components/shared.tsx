"use client";

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

export const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
};

export const ActionMenu = ({
    actions
}: {
    actions: { label: string, onClick: () => void, icon?: React.ReactNode, danger?: boolean }[]
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [coords, setCoords] = useState({ top: 0, left: 0, isUp: false, maxHeight: 320 });

    const toggleMenu = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isOpen && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            const MARGIN = 8;
            const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
            const spaceAbove = rect.top - MARGIN;
            const itemHeight = 36;
            const padding = 16;
            const naturalHeight = actions.length * itemHeight + padding;
            const shouldOpenUp = spaceBelow < naturalHeight && spaceAbove > spaceBelow;
            const maxHeight = shouldOpenUp
                ? Math.min(naturalHeight, spaceAbove)
                : Math.min(naturalHeight, spaceBelow);

            setCoords({
                top: shouldOpenUp
                    ? rect.top + window.scrollY - Math.min(naturalHeight, spaceAbove)
                    : rect.bottom + window.scrollY,
                left: rect.right + window.scrollX - 192,
                isUp: shouldOpenUp,
                maxHeight,
            });
        }
        setIsOpen(!isOpen);
    };

    useEffect(() => {
        setMounted(true);
        const handleClickOutside = () => setIsOpen(false);
        if (isOpen) {
            document.addEventListener('click', handleClickOutside);
        }
        return () => {
            document.removeEventListener('click', handleClickOutside);
        };
    }, [isOpen]);

    return (
        <>
            <button
                ref={buttonRef}
                onClick={toggleMenu}
                className="btn-icon"
            >
                <MoreVertical className="w-5 h-5 text-secondary" />
            </button>
            {mounted && isOpen && typeof document !== 'undefined' && createPortal(
                <div
                    className={`absolute w-48 menu-panel py-2 z-[9999] animate-in fade-in duration-200 overflow-y-auto ${coords.isUp ? 'slide-in-from-bottom-2' : 'slide-in-from-top-2'}`}
                    style={{ top: coords.top, left: coords.left, maxHeight: coords.maxHeight }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {actions.map((action, idx) => (
                        <button
                            key={idx}
                            onClick={(e) => { e.stopPropagation(); action.onClick(); setIsOpen(false); }}
                            className={`w-full text-left px-4 py-2 text-sm font-semibold hover:bg-base transition-colors flex items-center gap-2 ${action.danger ? 'text-red-500 hover:text-red-600' : 'text-primary'}`}
                        >
                            {action.icon}
                            {action.label}
                        </button>
                    ))}
                </div>,
                document.body
            )}
        </>
    );
};
