/**
 * Local Wi-Fi handshake for the QR same-network rule. The phone and the office screen open a WebRTC data channel
 * with no STUN / TURN servers, so only their local (host) addresses are tried: it connects only when both are on
 * the same local network, whichever IPv4 / IPv6 address the internet sees. Over it the screen passes the phone a
 * per-minute secret that never appears in the QR (see `lanProofFor`). Offers and answers travel through the app,
 * called on the Worker's own host (`origin`) so the screen's frequent polling never touches the erp.d4dx.co proxy.
 */

const GATHER_MS = 2_000;
const ANSWER_WAIT_MS = 7_000;
const CHANNEL_WAIT_MS = 6_000;
const SCREEN_POLL_MS = 1_500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves once the local candidates are gathered (host-only gathering is quick), or after GATHER_MS. */
function iceGathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState !== "complete") return;
      pc.removeEventListener("icegatheringstatechange", done);
      resolve();
    };
    pc.addEventListener("icegatheringstatechange", done);
    setTimeout(resolve, GATHER_MS);
  });
}

/**
 * Phone: the screen's local-network secret, or null when the handshake fails (another network, Wi-Fi that keeps
 * devices apart, no WebRTC). `start` sends the offer to the app and returns a token to poll for the answer.
 */
export async function proveLocalNetwork(start: (sdp: string) => Promise<{ token: string } | null>, origin: string): Promise<string | null> {
  if (typeof RTCPeerConnection === "undefined") return null;
  const pc = new RTCPeerConnection({ iceServers: [] });
  try {
    const channel = pc.createDataChannel("lan");
    const secret = new Promise<string | null>((resolve) => {
      channel.onmessage = (event) => resolve(typeof event.data === "string" ? event.data : null);
      setTimeout(() => resolve(null), ANSWER_WAIT_MS + CHANNEL_WAIT_MS);
    });
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc);
    const ticket = await start(pc.localDescription?.sdp ?? "");
    if (!ticket) return null;
    let answer: string | null = null;
    for (const until = Date.now() + ANSWER_WAIT_MS; !answer && Date.now() < until; ) {
      await sleep(500);
      answer = await fetch(`${origin}/api/kiosk/lan/answer?t=${encodeURIComponent(ticket.token)}`, { cache: "no-store", credentials: "omit" })
        .then((res) => (res.ok ? (res.json() as Promise<{ answer: string | null }>) : null))
        .then((body) => body?.answer ?? null)
        .catch(() => null);
    }
    if (!answer) return null;
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    return await secret;
  } catch {
    return null;
  } finally {
    pc.close();
  }
}

export interface LanHub {
  /** The Worker's own host ("" = same origin). */
  origin: string;
  /** Access token from /api/kiosk/code. */
  token: string;
  /** Current local-network secret from /api/kiosk/code. */
  secret: string;
}

/** Screen: answers phones' handshakes until the returned function is called. `hub` gives the latest token / secret. */
export function serveLocalNetworkProofs(hub: () => LanHub | null): () => void {
  if (typeof RTCPeerConnection === "undefined") return () => undefined;
  let stopped = false;
  const answered = new Set<string>();

  const answer = async (current: LanHub, id: string, sdp: string) => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    const giveUp = setTimeout(() => pc.close(), 30_000);
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      channel.onopen = () => {
        channel.send(hub()?.secret ?? current.secret);
        setTimeout(() => {
          clearTimeout(giveUp);
          pc.close();
        }, 3_000);
      };
    };
    try {
      await pc.setRemoteDescription({ type: "offer", sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await iceGathered(pc);
      await fetch(`${current.origin}/api/kiosk/lan/answer?t=${encodeURIComponent(current.token)}&id=${encodeURIComponent(id)}`, {
        method: "POST",
        body: pc.localDescription?.sdp ?? "",
        credentials: "omit",
      });
    } catch {
      clearTimeout(giveUp);
      pc.close();
    }
  };

  void (async () => {
    while (!stopped) {
      const current = hub();
      // Not tied to visibility: a screen whose window is covered still answers phones that scanned it a moment ago.
      if (current) {
        try {
          const res = await fetch(`${current.origin}/api/kiosk/lan/offers?t=${encodeURIComponent(current.token)}`, { cache: "no-store", credentials: "omit" });
          if (res.ok) {
            const { offers } = (await res.json()) as { offers: { id: string; sdp: string }[] };
            for (const offer of offers) {
              if (answered.has(offer.id)) continue;
              if (answered.size > 500) answered.clear();
              answered.add(offer.id);
              void answer(current, offer.id, offer.sdp);
            }
          }
        } catch {
          // Offline for a moment: the next round tries again.
        }
      }
      await sleep(SCREEN_POLL_MS);
    }
  })();
  return () => {
    stopped = true;
  };
}
