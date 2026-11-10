"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Copy, CornerUpLeft, Loader2, MessagesSquare, Mic, MoreHorizontal, Pause, Play, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { uploadFile } from "@/components/ui/file-upload";
import { useServerAction } from "@/components/ui/form";
import { Menu } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { dateKey, fmtDate, fmtTime, todayKey } from "@/lib/time";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limit";
import { deleteChatMessage, sendChatMessage } from "./chat-actions";
import { VOICE_MAX_SECONDS, type ChatMember, type ChatMessageView } from "./chat-types";

const POLL_MS = 4000;
/** Opus at this rate keeps a two-minute voice message under the 300 KB upload limit. */
const VOICE_BITRATE = 16_000;
const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];

/** Adds new or changed messages; returns null when nothing changed (so a quiet poll does not re-render). */
function merge(list: ChatMessageView[], incoming: ChatMessageView[]): ChatMessageView[] | null {
  const byId = new Map(list.map((m) => [m.id, m]));
  let changed = false;
  for (const m of incoming) {
    const current = byId.get(m.id);
    if (current && current.updated >= m.updated) continue;
    byId.set(m.id, m);
    changed = true;
  }
  return changed ? [...byId.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)) : null;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Seconds since it was started (kept outside components: they may not read the clock). */
function stopwatch(): () => number {
  const started = Date.now();
  return () => (Date.now() - started) / 1000;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The "@query" being typed just before the caret, if any. */
function mentionAt(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) return null;
  const query = before.slice(at + 1);
  return query.length <= 30 && !query.includes("\n") ? { start: at, query } : null;
}

export function ChatPanel({
  projectId,
  me,
  moderator,
  members,
  initial,
  hasMore,
}: {
  projectId: string;
  me: string;
  /** May delete anyone's message (the super admin). */
  moderator: boolean;
  members: ChatMember[];
  initial: ChatMessageView[];
  hasMore: boolean;
}) {
  const [messages, setMessages] = useState(initial);
  const [more, setMore] = useState(hasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessageView | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const { pending, run } = useServerAction();
  const confirm = useConfirm();

  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const restore = useRef<{ height: number; top: number } | null>(null);
  const cursor = useRef(0);

  const byMember = new Map(members.map((m) => [m.id, m]));
  const byMessage = new Map(messages.map((m) => [m.id, m]));
  const newest = messages.reduce((max, m) => Math.max(max, m.updated), 0);

  useEffect(() => {
    cursor.current = newest;
  }, [newest]);

  function add(incoming: ChatMessageView[]) {
    setMessages((list) => merge(list, incoming) ?? list);
  }

  // Poll while the chat is on screen; check at once when the tab comes back.
  useEffect(() => {
    let busy = false;
    async function tick() {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const res = await fetch(`/api/projects/${projectId}/chat?since=${cursor.current}&read=1`, { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { messages: ChatMessageView[] };
          if (body.messages.length) setMessages((list) => merge(list, body.messages) ?? list);
        }
      } catch {
        // Offline for a moment: the next tick tries again.
      } finally {
        busy = false;
      }
    }
    const timer = window.setInterval(() => void tick(), POLL_MS);
    const onVisible = () => void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [projectId]);

  // Keep the newest message in view (unless the reader scrolled up); keep the position when older ones load above.
  const firstId = messages[0]?.id;
  const lastId = messages.at(-1)?.id;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (restore.current) {
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top;
      restore.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [firstId, lastId]);

  async function loadOlder() {
    const el = listRef.current;
    const oldest = messages[0];
    if (!el || !oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/chat?before=${oldest.at}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { messages: ChatMessageView[]; more: boolean };
      restore.current = { height: el.scrollHeight, top: el.scrollTop };
      add(body.messages);
      setMore(body.more);
    } catch {
      toast.error("Could not load earlier messages");
    } finally {
      setLoadingOlder(false);
    }
  }

  function jumpTo(id: string) {
    const target = document.getElementById(`m-${id}`);
    if (!target) {
      toast.message("That message is further up — load earlier messages to see it.");
      return;
    }
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(id);
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600);
  }

  async function remove(m: ChatMessageView) {
    const ok = await confirm({ title: "Delete message", description: "Delete this message for everyone? This cannot be undone.", confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    run(() => deleteChatMessage(projectId, m.id), { refresh: false, onSuccess: (row) => add([row]) });
  }

  function sent(row: ChatMessageView) {
    stick.current = true;
    add([row]);
    setReplyTo(null);
  }

  const today = todayKey();
  // A new author, a new day or a pause of 5 minutes starts a new group (name + avatar shown again).
  const rows: { m: ChatMessageView; day: string; newDay: boolean; head: boolean }[] = [];
  for (const [i, m] of messages.entries()) {
    const prev = messages[i - 1];
    const day = dateKey(new Date(m.at));
    const newDay = !prev || dateKey(new Date(prev.at)) !== day;
    rows.push({ m, day, newDay, head: newDay || prev.userId !== m.userId || m.at - prev.at > 5 * 60_000 });
  }

  return (
    <Card className="flex h-[min(760px,calc(100dvh-230px))] min-h-[440px] flex-col overflow-hidden">
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="relative flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5"
        aria-live="polite"
      >
        {more && (
          <div className="mb-2 flex justify-center">
            <Button variant="ghost" size="sm" loading={loadingOlder} onClick={() => void loadOlder()}>
              Load earlier messages
            </Button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted">
            <MessagesSquare className="size-8 text-subtle" aria-hidden />
            <p className="text-sm font-semibold text-ink-2">No messages yet</p>
            <p className="max-w-sm text-[13px]">Discuss the project with its team here. Type @ to mention someone, or hold a conversation with voice messages.</p>
          </div>
        )}
        {rows.map(({ m, day, newDay, head }) => {
          const mine = m.userId === me;
          const replied = m.reply ? byMessage.get(m.reply.id) : undefined;
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="my-3 flex items-center gap-3 text-[11px] font-semibold tracking-wide text-muted uppercase">
                  <span className="h-px flex-1 bg-line-soft" />
                  {day === today ? "Today" : fmtDate(day)}
                  <span className="h-px flex-1 bg-line-soft" />
                </div>
              )}
              <MessageRow
                m={m}
                mine={mine}
                head={head}
                photo={byMember.get(m.userId)?.photo}
                mentionNames={m.mentions.flatMap((id) => {
                  const member = byMember.get(id);
                  return member ? [{ name: member.name, me: id === me }] : [];
                })}
                replyDeleted={Boolean(replied?.deleted)}
                flash={flash === m.id}
                onReply={() => setReplyTo(m)}
                onJump={jumpTo}
                onDelete={!m.deleted && (mine || moderator) ? () => void remove(m) : undefined}
              />
            </Fragment>
          );
        })}
      </div>
      <Composer projectId={projectId} me={me} members={members} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} onSent={sent} pending={pending} run={run} />
    </Card>
  );
}

/** Text with @mentions highlighted and web links clickable. */
function RichText({ text, mentions, mine }: { text: string; mentions: { name: string; me: boolean }[]; mine: boolean }) {
  const names = [...mentions].sort((a, b) => b.name.length - a.name.length);
  const pattern = new RegExp(`(https?://[^\\s<]+[^\\s<.,;:!?)\\]'"])${names.length ? `|@(${names.map((n) => escapeRegExp(n.name)).join("|")})` : ""}`, "g");
  const parts: ReactNode[] = [];
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > index) parts.push(text.slice(index, match.index));
    if (match[1]) {
      parts.push(
        <a key={match.index} href={match[1]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 [overflow-wrap:anywhere]">
          {match[1]}
        </a>,
      );
    } else {
      const isMe = names.some((n) => n.me && n.name === match[2]);
      parts.push(
        <span key={match.index} className={cn("font-semibold", mine ? "text-white" : "text-brand-700", isMe && (mine ? "rounded bg-white/20 px-0.5" : "rounded bg-brand-100 px-0.5"))}>
          @{match[2]}
        </span>,
      );
    }
    index = match.index + match[0].length;
  }
  if (index < text.length) parts.push(text.slice(index));
  return <span className="break-words whitespace-pre-wrap">{parts}</span>;
}

function MessageRow({
  m,
  mine,
  head,
  photo,
  mentionNames,
  replyDeleted,
  flash,
  onReply,
  onJump,
  onDelete,
}: {
  m: ChatMessageView;
  mine: boolean;
  head: boolean;
  photo?: string;
  mentionNames: { name: string; me: boolean }[];
  replyDeleted: boolean;
  flash: boolean;
  onReply: () => void;
  onJump: (id: string) => void;
  onDelete?: () => void;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(m.text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy");
    }
  }
  return (
    <div id={`m-${m.id}`} className={cn("group flex items-end gap-2 scroll-mt-16", mine && "flex-row-reverse", head ? "mt-3" : "mt-0.5")}>
      {!mine && (head ? <Avatar name={m.userName} src={photo} size="sm" /> : <span className="w-8 shrink-0" aria-hidden />)}
      <div className={cn("flex max-w-[85%] min-w-0 flex-col sm:max-w-[70%]", mine && "items-end")}>
        {head && !mine && <span className="mb-0.5 px-1 text-xs font-semibold text-ink-2">{m.userName}</span>}
        <div className={cn("flex max-w-full items-center gap-1", mine && "flex-row-reverse")}>
          <div
            className={cn(
              "min-w-0 rounded-2xl px-3 py-2 text-[14px] leading-snug transition-shadow",
              mine ? "rounded-br-md bg-brand-600 text-white" : "rounded-bl-md bg-field text-ink",
              m.deleted && (mine ? "bg-brand-600/60" : "bg-field/70"),
              flash && "ring-2 ring-amber-400 ring-offset-2",
            )}
          >
            {m.reply && !m.deleted && (
              <button
                type="button"
                onClick={() => onJump(m.reply!.id)}
                className={cn(
                  "mb-1.5 block w-full min-w-0 rounded-lg border-l-[3px] px-2 py-1 text-left text-xs",
                  mine ? "border-white/70 bg-white/15 text-white/90" : "border-brand-500 bg-white text-ink-2",
                )}
              >
                <span className="block font-semibold">{m.reply.userName}</span>
                <span className="line-clamp-2 break-words">
                  {replyDeleted ? (
                    <em>Message deleted</em>
                  ) : m.reply.text ? (
                    m.reply.text
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Mic className="size-3" aria-hidden /> Voice message
                    </span>
                  )}
                </span>
              </button>
            )}
            {m.deleted ? (
              <em className={cn("text-[13px]", mine ? "text-white/80" : "text-muted")}>This message was deleted</em>
            ) : (
              <>
                {m.voice && <VoiceNote url={m.voice.url} seconds={m.voice.seconds} mine={mine} />}
                {m.text && <RichText text={m.text} mentions={mentionNames} mine={mine} />}
              </>
            )}
            <span className={cn("mt-0.5 block text-right text-[10px] tabular", mine ? "text-white/70" : "text-muted")}>{fmtTime(new Date(m.at))}</span>
          </div>
          {!m.deleted && (
            <Menu
              label="Message actions"
              align={mine ? "end" : "start"}
              trigger={
                <button
                  type="button"
                  aria-label="Message actions"
                  className="grid size-7 shrink-0 place-items-center rounded-full text-subtle opacity-0 group-hover:opacity-100 hover:bg-field hover:text-ink focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-60"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              }
              items={[
                { label: "Reply", icon: <CornerUpLeft className="size-4 text-muted" />, onSelect: onReply },
                m.text ? { label: "Copy text", icon: <Copy className="size-4 text-muted" />, onSelect: () => void copy() } : null,
                onDelete ? { label: "Delete", icon: <Trash2 className="size-4" />, onSelect: onDelete, danger: true } : null,
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Compact player for a voice message (one plays at a time). */
function VoiceNote({ url, seconds, mine }: { url: string; seconds: number; mine: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(seconds);

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    document.querySelectorAll("audio").forEach((other) => {
      if (other !== el) other.pause();
    });
    el.play().catch(() => toast.error("This voice message can't be played in this browser."));
  }

  return (
    <div className="flex w-60 max-w-full items-center gap-2.5 py-0.5">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        className={cn("grid size-9 shrink-0 place-items-center rounded-full", mine ? "bg-white text-brand-700" : "bg-brand-600 text-white")}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className={cn("h-1.5 overflow-hidden rounded-full", mine ? "bg-white/30" : "bg-line")}>
          <div className={cn("h-full rounded-full", mine ? "bg-white" : "bg-brand-600")} style={{ width: `${length ? Math.min(100, (position / length) * 100) : 0}%` }} />
        </div>
        <span className={cn("text-[11px] tabular", mine ? "text-white/80" : "text-muted")}>{clock(playing || position > 0 ? position : length)}</span>
      </div>
      <audio
        ref={audio}
        src={url}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        // Recorded WebM often reports no duration until played through; the length saved with the message is used until then.
        onLoadedMetadata={(e) => {
          const duration = e.currentTarget.duration;
          if (Number.isFinite(duration) && duration > 0) setLength(duration);
        }}
      />
    </div>
  );
}

type Run = ReturnType<typeof useServerAction>["run"];

function Composer({
  projectId,
  me,
  members,
  replyTo,
  onCancelReply,
  onSent,
  pending,
  run,
}: {
  projectId: string;
  me: string;
  members: ChatMember[];
  replyTo: ChatMessageView | null;
  onCancelReply: () => void;
  onSent: (row: ChatMessageView) => void;
  pending: boolean;
  run: Run;
}) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const discard = useRef(false);
  const ticker = useRef(0);
  const reply = useRef(replyTo);

  useEffect(() => {
    reply.current = replyTo;
    if (replyTo) input.current?.focus();
  }, [replyTo]);

  // Leaving the page mid-recording throws the recording away and frees the microphone.
  useEffect(
    () => () => {
      discard.current = true;
      window.clearInterval(ticker.current);
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    },
    [],
  );

  const others = members.filter((m) => m.id !== me);
  const mention = caret !== null ? mentionAt(text, caret) : null;
  const options = mention && mention.start !== dismissed ? others.filter((m) => m.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6) : [];
  const pick = Math.min(active, Math.max(0, options.length - 1));

  function track(el: HTMLTextAreaElement) {
    setCaret(el.selectionStart);
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }

  function choose(member: ChatMember) {
    if (!mention || caret === null) return;
    const insert = `@${member.name} `;
    const next = text.slice(0, mention.start) + insert + text.slice(caret);
    const position = mention.start + insert.length;
    setText(next);
    setCaret(position);
    setActive(0);
    window.requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(position, position);
    });
  }

  function send() {
    const value = text.trim();
    if (!value || pending) return;
    // Everyone whose "@Name" is in the text, whether picked from the list or typed in full.
    const mentions = others.filter((m) => value.includes(`@${m.name}`)).map((m) => m.id);
    run(() => sendChatMessage(projectId, { text: value, replyTo: reply.current?.id, mentions }), {
      successMessage: false,
      refresh: false,
      onSuccess: (row) => {
        setText("");
        setCaret(null);
        if (input.current) input.current.style.height = "auto";
        onSent(row);
      },
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (options.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((pick + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(options[pick]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(mention!.start);
        return;
      }
    }
    // Enter sends on a keyboard; on touch screens it adds a line (send with the button).
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(hover: hover)").matches) {
      e.preventDefault();
      send();
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Voice messages are not supported in this browser.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Allow microphone access to record a voice message.");
      return;
    }
    const mimeType = RECORDING_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: VOICE_BITRATE });
    const chunks: Blob[] = [];
    const elapsedSeconds = stopwatch();
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      window.clearInterval(ticker.current);
      recorder.current = null;
      setRecording(false);
      if (discard.current) return;
      const seconds = Math.max(1, Math.round(elapsedSeconds()));
      void sendVoice(new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" }), seconds);
    };
    discard.current = false;
    recorder.current = rec;
    rec.start(1000);
    setElapsed(0);
    setRecording(true);
    ticker.current = window.setInterval(() => {
      const s = elapsedSeconds();
      setElapsed(s);
      if (s >= VOICE_MAX_SECONDS && rec.state === "recording") rec.stop();
    }, 250);
  }

  function stopRecording(keep: boolean) {
    discard.current = !keep;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  async function sendVoice(blob: Blob, seconds: number) {
    const mime = blob.type.split(";")[0] || "audio/webm";
    if (blob.size > MAX_UPLOAD_BYTES) {
      toast.error("That voice message is too long to send. Please keep it shorter.");
      return;
    }
    setUploading(true);
    try {
      const ext = mime === "audio/mp4" ? "m4a" : mime === "audio/ogg" ? "ogg" : "webm";
      const file = await uploadFile(new File([blob], `voice-message.${ext}`, { type: mime }), { entityType: "project", entityId: projectId });
      run(() => sendChatMessage(projectId, { voice: file.id, seconds, replyTo: reply.current?.id }), { successMessage: false, refresh: false, onSuccess: onSent });
    } catch (error) {
      toast.error((error as Error).message || "Could not send the voice message");
    } finally {
      setUploading(false);
    }
  }

  const busy = pending || uploading;
  return (
    <div className="border-t border-line-soft bg-white p-2.5 sm:p-3">
      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border-l-[3px] border-brand-500 bg-field px-3 py-1.5 text-xs">
          <CornerUpLeft className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-ink-2">Replying to {replyTo.userId === me ? "yourself" : replyTo.userName}</span>
            <span className="block truncate text-muted">{replyTo.text || (replyTo.voice ? "Voice message" : "")}</span>
          </div>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply" className="grid size-6 place-items-center rounded text-subtle hover:bg-white hover:text-ink">
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {recording ? (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Discard recording" onClick={() => stopRecording(false)}>
            <Trash2 className="size-4 text-danger" />
          </Button>
          <div className="flex h-10 flex-1 items-center gap-2.5 rounded-[10px] bg-danger-bg px-3 text-sm text-danger">
            <span className="size-2.5 animate-pulse rounded-full bg-danger" aria-hidden />
            <span className="font-semibold tabular">{clock(elapsed)}</span>
            <span className="truncate text-xs text-danger/80 max-sm:hidden">Recording · up to {VOICE_MAX_SECONDS / 60} minutes</span>
          </div>
          <Button size="icon" aria-label="Send voice message" onClick={() => stopRecording(true)}>
            <Send className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="relative flex items-end gap-2">
          {options.length > 0 && (
            <ul role="listbox" aria-label="Mention someone" className="absolute bottom-full left-0 z-20 mb-2 w-64 max-w-full overflow-hidden rounded-xl border border-line bg-white p-1 shadow-popover">
              {options.map((m, i) => (
                <li key={m.id} role="option" aria-selected={i === pick}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(m)}
                    className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium", i === pick ? "bg-field" : "hover:bg-field")}
                  >
                    <Avatar name={m.name} src={m.photo} size="xs" />
                    <span className="truncate">{m.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            ref={input}
            value={text}
            rows={1}
            maxLength={4000}
            placeholder="Message the team · @ to mention"
            aria-label="Message"
            onChange={(e) => {
              setText(e.target.value);
              setDismissed(null);
              setActive(0);
              track(e.target);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onBlur={() => window.setTimeout(() => setCaret(null), 150)}
            className="max-h-36 min-h-10 flex-1 resize-none rounded-[10px] border border-line-strong bg-white px-3 py-2 text-base text-ink placeholder:text-subtle focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100 focus:outline-none sm:text-sm"
          />
          {text.trim() ? (
            <Button size="icon" aria-label="Send message" loading={pending} onClick={send}>
              <Send className="size-4" />
            </Button>
          ) : (
            <Button variant="secondary" size="icon" aria-label="Record a voice message" disabled={busy} onClick={() => void startRecording()}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
