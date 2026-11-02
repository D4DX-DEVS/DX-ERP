import { useEffect, useState } from "react";

/**
 * Browser events that keep the top-bar unread badge and the notifications inbox in step without waiting for the
 * badge's next poll. Client-only: call from event handlers or effects.
 */
const CHANGED = "dx:unread-changed";
const POLL = "dx:unread-poll";
const POLLED = "dx:unread-polled";

/** The user just read (negative) or un-read (positive) notifications: move the badge now. */
export function shiftUnread(delta: number): void {
  if (delta) window.dispatchEvent(new CustomEvent(CHANGED, { detail: delta }));
}

/** Ask the badge to fetch the real count now (after a change settles, or to look for new notifications). */
export function requestUnreadPoll(): void {
  window.dispatchEvent(new Event(POLL));
}

/** Published by the badge after every successful poll. */
export function reportUnreadCount(count: number): void {
  window.dispatchEvent(new CustomEvent(POLLED, { detail: count }));
}

export function onUnreadEvents(handlers: { changed?: (delta: number) => void; poll?: () => void; polled?: (count: number) => void }): () => void {
  const changed = (e: Event) => handlers.changed?.((e as CustomEvent<number>).detail);
  const poll = () => handlers.poll?.();
  const polled = (e: Event) => handlers.polled?.((e as CustomEvent<number>).detail);
  window.addEventListener(CHANGED, changed);
  window.addEventListener(POLL, poll);
  window.addEventListener(POLLED, polled);
  return () => {
    window.removeEventListener(CHANGED, changed);
    window.removeEventListener(POLL, poll);
    window.removeEventListener(POLLED, polled);
  };
}

/** Unread count for a badge that does not poll itself: follows the server value, local changes and the top bar's polls. */
export function useLiveUnread(initial: number): number {
  const [count, setCount] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setCount(initial);
  }
  useEffect(() => onUnreadEvents({ changed: (delta) => setCount((c) => Math.max(0, c + delta)), polled: setCount }), []);
  return count;
}
