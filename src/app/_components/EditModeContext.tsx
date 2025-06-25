"use client"

import { createContext, useState, ReactNode, useCallback } from "react";

export type EditModeContextType = {
    isEditing: boolean;
    toggle: () => void;
    canEdit: boolean;
};

export const EditModeContext = createContext<EditModeContextType>({
    isEditing: false,
    toggle: () => {},
    canEdit: false,
});

export function EditModeProvider({ children, canEdit }: { children: ReactNode; canEdit: boolean }) {
    const [isEditing, setIsEditing] = useState(false);

    const toggle = useCallback(() => {
        setIsEditing((prev) => !prev);
    }, []);

    return (
        <EditModeContext.Provider value={{ isEditing, toggle, canEdit }}>
            {children}
        </EditModeContext.Provider>
    );
} 