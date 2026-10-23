"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { useServerAction } from "@/components/ui/form";
import { uploadFile } from "@/components/ui/file-upload";
import { setPhoto } from "../[id]/actions";

/** Avatar with a "change photo" button: uploads a public avatar file, then sets it on the profile. */
export function PhotoUpload({ userId, name, photo, canEdit, size = "xl" }: { userId: string; name: string; photo?: string; canEdit: boolean; size?: "lg" | "xl" }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { pending, run } = useServerAction();
  const busy = uploading || pending;

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      toast.error("Choose a PNG, JPG or WebP image.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error("The photo must be smaller than 3 MB.");
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadFile(file, { entityType: "avatar", entityId: userId, isPublic: true });
      run(() => setPhoto(userId, uploaded.id), { successMessage: "Photo updated" });
    } catch (error) {
      toast.error((error as Error).message || "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="relative shrink-0">
      <Avatar name={name} src={photo} size={size} />
      {canEdit && (
        <>
          <button
            type="button"
            aria-label="Change photo"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="absolute -right-1 -bottom-1 flex size-8 items-center justify-center rounded-full border-2 border-white bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:opacity-70"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
          </button>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => void onFile(e.target.files?.[0])} />
        </>
      )}
    </div>
  );
}
