"use client";

import { useState } from "react";
import { BookOpen, ExternalLink, FlaskConical, FolderGit2, Globe, LayoutDashboard, Link2, Palette, Pencil, Plus, Server, Trash2, type LucideIcon } from "lucide-react";
import type { ProjectLinkKind } from "@/lib/models";
import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/input";
import { deleteProjectLink, saveProjectLink } from "../actions";

export interface ProjectLinkView {
  id: string;
  kind: ProjectLinkKind;
  label: string;
  url: string;
}

const KINDS: Record<ProjectLinkKind, { label: string; Icon: LucideIcon }> = {
  repository: { label: "Repository", Icon: FolderGit2 },
  live: { label: "Live site", Icon: Globe },
  staging: { label: "Staging", Icon: FlaskConical },
  backend: { label: "Backend / API", Icon: Server },
  admin: { label: "Admin panel", Icon: LayoutDashboard },
  design: { label: "Design", Icon: Palette },
  docs: { label: "Documentation", Icon: BookOpen },
  other: { label: "Other", Icon: Link2 },
};

/** "https://github.com/d4dx/app/" → "github.com/d4dx/app" */
const displayUrl = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");

function LinkForm({ projectId, link, onDone }: { projectId: string; link?: ProjectLinkView; onDone: () => void }) {
  return (
    <ActionForm action={(input) => saveProjectLink(projectId, link?.id, input)} successMessage={link ? "Link saved" : "Link added"} onSuccess={onDone}>
      <FormGrid>
        <Field label="Type" name="kind" required>
          <Select id="kind" name="kind" defaultValue={link?.kind ?? "repository"}>
            {(Object.keys(KINDS) as ProjectLinkKind[]).map((k) => (
              <option key={k} value={k}>
                {KINDS[k].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Label" name="label" hint="Optional, e.g. Frontend repo">
          <Input id="label" name="label" defaultValue={link?.label} maxLength={100} autoComplete="off" />
        </Field>
        <Field label="URL" name="url" required className="sm:col-span-2">
          <Input id="url" name="url" inputMode="url" defaultValue={link?.url} maxLength={2000} autoComplete="off" spellCheck={false} placeholder="https://github.com/d4dx/project" />
        </Field>
      </FormGrid>
      <FormActions>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton>{link ? "Save link" : "Add link"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

function LinkDialog({ projectId, link }: { projectId: string; link?: ProjectLinkView }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={link ? "Edit link" : "New link"}
      trigger={
        link ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${link.label || KINDS[link.kind].label}`}>
            <Pencil className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button size="sm" icon={<Plus className="size-4" aria-hidden />}>
            Link
          </Button>
        )
      }
    >
      <LinkForm projectId={projectId} link={link} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

/** Project links: code repositories, live and staging sites, backend URLs, design files, docs. */
export function LinksPanel({ projectId, links, canManage }: { projectId: string; links: ProjectLinkView[]; canManage: boolean }) {
  return (
    <Card>
      <CardHeader title="Links" subtitle="Repositories, live site, backend and other project URLs" action={canManage && <LinkDialog projectId={projectId} />} />
      <CardBody>
        {links.length === 0 ? (
          <p className="text-[13px] text-muted">No links yet.{canManage ? " Add the repository, live site and backend URLs." : ""}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {links.map((l) => {
              const { label, Icon } = KINDS[l.kind] ?? KINDS.other;
              return (
                <li key={l.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600" aria-hidden>
                    <Icon className="size-4" />
                  </span>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="group min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-medium text-ink group-hover:text-brand-600">
                      <span className="min-w-0 break-words">{l.label || label}</span>
                      <ExternalLink className="size-3.5 shrink-0 text-muted" aria-hidden />
                    </span>
                    <span className="block text-xs break-all text-muted">
                      {l.label ? `${label} · ` : ""}
                      {displayUrl(l.url)}
                    </span>
                  </a>
                  {canManage && (
                    <>
                      <LinkDialog projectId={projectId} link={l} />
                      <ActionButton
                        action={() => deleteProjectLink(projectId, l.id)}
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${l.label || label}`}
                        confirmTone="danger"
                        confirmTitle="Remove link"
                        confirmLabel="Remove"
                        confirm={`Remove ${l.label || displayUrl(l.url)} from the project?`}
                        successMessage="Link removed"
                      >
                        <Trash2 className="size-4 text-danger" aria-hidden />
                      </ActionButton>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
