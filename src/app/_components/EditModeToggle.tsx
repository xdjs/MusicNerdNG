"use client"

import { useContext } from "react";
import { EditModeContext } from "./EditModeContext";
import { Button } from "@/components/ui/button";
import { Pencil, Check } from "lucide-react";

export default function EditModeToggle({ className = "" }: { className?: string }) {
    const { isEditing, toggle, canEdit } = useContext(EditModeContext);
    if (!canEdit) return null;

    return (
        <Button onClick={toggle} className={`bg-gray-200 text-black hover:bg-gray-300 ${className}`} size="sm">
            {isEditing ? (
                <div className="flex items-center gap-1">
                    <Check size={14} /> Done
                </div>
            ) : (
                <div className="flex items-center gap-1">
                    <Pencil size={14} /> Edit
                </div>
            )}
        </Button>
    );
} 