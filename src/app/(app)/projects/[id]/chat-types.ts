/** Project chat view models (plain data, shared by the server, the polling route and the chat panel). */

export interface ChatMember {
  id: string;
  name: string;
  photo?: string;
}

export interface ChatMessageView {
  id: string;
  userId: string;
  userName: string;
  /** Empty for voice-only and deleted messages. */
  text: string;
  /** Ids of the people @mentioned in the text. */
  mentions: string[];
  reply?: { id: string; userName: string; text?: string; voice?: boolean };
  voice?: { url: string; seconds: number };
  /** Sent at (epoch ms). */
  at: number;
  /** Last change (epoch ms): the polling cursor. */
  updated: number;
  deleted: boolean;
}

/** Longest voice message, in seconds (kept under the upload size limit at the recording bitrate). */
export const VOICE_MAX_SECONDS = 120;
