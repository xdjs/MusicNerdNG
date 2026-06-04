"use client"

import { createContext, useState, ReactNode } from "react";

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

export function EditModeProvider({ children, canEdit = false }: { children: ReactNode; canEdit?: boolean }) {
    const [isEditing, setIsEditing] = useState(false);

    return (
        <EditModeContext.Provider value={{
            isEditing: canEdit ? isEditing : false,
            toggle: () => canEdit && setIsEditing(prev => !prev),
            canEdit,
        }}>
            {children}
        </EditModeContext.Provider>
    );
}
