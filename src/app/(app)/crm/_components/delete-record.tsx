"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { deleteLead } from "../actions";
import { deleteClient } from "../clients/actions";

/** Delete a lead or client (crm.delete). The server refuses when anything is linked to the record. */
export function DeleteRecord({ kind, id, name, redirectTo }: { kind: "lead" | "client"; id: string; name: string; redirectTo: string }) {
  const router = useRouter();
  return (
    <ActionButton
      variant="danger-outline"
      icon={<Trash2 className="size-4" aria-hidden />}
      className="max-sm:w-9 max-sm:px-0"
      confirm={`Delete ${name}? This permanently removes the ${kind}${kind === "client" ? ", its contacts and communication history" : " and its activity"}. This can't be undone.`}
      confirmTitle="Delete?"
      confirmLabel="Delete"
      action={() => (kind === "lead" ? deleteLead(id) : deleteClient(id))}
      successMessage={false}
      onSuccess={() => router.push(redirectTo)}
    >
      <span className="max-sm:sr-only">Delete</span>
    </ActionButton>
  );
}
