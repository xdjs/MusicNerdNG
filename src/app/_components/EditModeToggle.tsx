"use client"

import { useContext } from "react";
import { Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditModeContext } from "./EditModeContext";

export default function EditModeToggle() {
    const { isEditing, toggle, canEdit } = useContext(EditModeContext);
    if (!canEdit) return null;

    return (
        <Button
            variant="outline"
            size="sm"
            onClick={toggle}
            data-testid="edit-mode-toggle"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200 border-pastypink/50 text-pastypink hover:bg-pastypink hover:text-white"
        >
            {isEditing ? <Check size={14} /> : <Pencil size={14} />}
            {isEditing ? "Done" : "Edit"}
        </Button>
    );
}
