"use client";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { User } from "@/server/db/DbTypes";
import { useRouter } from "next/navigation";

interface WhitelistUserEditDialogProps {
  user: User;
}

export default function WhitelistUserEditDialog({ user }: WhitelistUserEditDialogProps) {
  const [open, setOpen] = useState(false);
  const [wallet, setWallet] = useState(user.wallet || "");
  const [email, setEmail] = useState(user.email || "");
  const [username, setUsername] = useState(user.username || "");
  const [uploadStatus, setUploadStatus] = useState<{ status: "success" | "error"; message: string; isLoading: boolean }>({ status: "success", message: "", isLoading: false });
  const router = useRouter();

  async function handleSave() {
    setUploadStatus({ status: "success", message: "", isLoading: true });
    const resp = await fetch(`/api/admin/whitelist-user/${user.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ wallet, email, username }),
      credentials: "same-origin",
    });
    const data = await resp.json();
    setUploadStatus({ status: data.status, message: data.message, isLoading: false });
    if (data.status === "success") {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Edit</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] text-black">
        <DialogHeader>
          <DialogTitle>Edit Whitelisted User</DialogTitle>
          <DialogDescription>Update username, email, or wallet address.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Wallet Address</label>
            <Input value={wallet} onChange={(e) => setWallet(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Username</label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          {uploadStatus.status === "error" && (
            <p className="text-red-500 text-sm">{uploadStatus.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleSave} disabled={uploadStatus.isLoading}>
            {uploadStatus.isLoading ? (
              <img className="w-4 h-4" src="/spinner.svg" alt="Loading" />
            ) : (
              "Save Changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 