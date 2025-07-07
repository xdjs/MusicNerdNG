"use client"

import Link from "next/link";
import { useContext, useState } from "react";
import { EditModeContext } from "./EditModeContext";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

interface Props {
    link: string;
    descriptor: string;
    image: string;
    siteName: string;
    artistId: string;
}

export default function EditablePlatformLink({ link, descriptor, image, siteName, artistId }: Props) {
    const { isEditing } = useContext(EditModeContext);
    const router = useRouter();
    const [isDeleting, setIsDeleting] = useState(false);
    const { toast } = useToast();

    async function handleDelete(e: React.MouseEvent) {
        e.preventDefault();
        if (!window.confirm(`Remove ${link}?`)) return;
        setIsDeleting(true);
        try {
            const response = await fetch("/api/removeArtistData", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ artistId, siteName }),
            });
            if (response.ok) {
                const formattedSite = siteName.charAt(0).toUpperCase() + siteName.slice(1);
                toast({
                    title: `${formattedSite} link has been removed`,
                });
            } else {
                const data = await response.json().catch(() => ({}));
                toast({
                    title: "Error removing metadata",
                    description: data?.message ?? "Please try again.",
                });
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsDeleting(false);
            router.refresh();
        }
    }

    return (
        <li className="list-none relative">
            {isEditing && (
                <button
                    onClick={handleDelete}
                    className="absolute right-0 top-1/2 -translate-y-1/2 text-red-600 hover:text-red-800 p-1"
                    title="Delete"
                >
                    {isDeleting ? (
                        <img src="/spinner.svg" className="h-4 w-4" alt="loading" />
                    ) : (
                        <Trash2 size={16} />
                    )}
                </button>
            )}
            <Link href={`${link}`} target="blank" className="text-black">
                <div className="link-item-grid gap-x-4 corners-rounded pr-8">{/* pr-8 to make space for delete btn */}
                    <img className="mr-3" src={image} alt="" height={50} width={50} />
                    <label className="pr-4 cursor-pointer"> {descriptor} </label>
                </div>
            </Link>
        </li>
    );
} 