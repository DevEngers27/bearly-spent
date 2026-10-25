// Optional Cartesia (Sonic) text-to-speech for Money Buddy.
//
// Browser flow, per https://docs.cartesia.ai/get-started/authenticate-your-client-applications:
//   1. The browser asks our backend for a short-lived access token (TTS grant only).
//   2. The browser calls POST https://api.cartesia.ai/tts/bytes with that token
//      and plays the returned audio.
// The API key never leaves the server. `synthesize` is a server-side proxy the
// client falls back to if it can't reach Cartesia directly. When
// CARTESIA_API_KEY is unset, the client uses the browser's speech synthesis.
const API = process.env.CARTESIA_BASE_URL || "https://api.cartesia.ai";
export const CARTESIA_VERSION = process.env.CARTESIA_VERSION || "2026-08-14";

export const voiceEnabled = () => Boolean(process.env.CARTESIA_API_KEY);

// Everything the browser needs to build the /tts/bytes request (no secrets).
export function voiceConfig() {
  return {
    model_id: process.env.CARTESIA_MODEL || "sonic-3.6",
    // Default voice is the one used in Cartesia's own docs example; override with CARTESIA_VOICE_ID.
    voice: { id: process.env.CARTESIA_VOICE_ID || "6ccbfb76-1fc6-48f7-b71d-91ac6298247b" },
    output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
    language: "en",
    // Slightly slower and upbeat for young listeners.
    generation_config: { speed: 0.95, emotion: "enthusiastic" },
  };
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.CARTESIA_API_KEY}`,
    "Cartesia-Version": CARTESIA_VERSION,
    "Content-Type": "application/json",
  };
}

async function cartesiaError(res) {
  // 2026-03-01+ returns structured JSON errors.
  const body = await res.json().catch(() => null);
  const msg = body?.message || body?.error?.message || body?.title || res.statusText;
  return new Error(`Cartesia ${res.status}: ${msg}`);
}

/** Mint a 60-second, TTS-only access token for the browser. */
export async function mintAccessToken() {
  const res = await fetch(`${API}/access-token`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ grants: { tts: true }, expires_in: 60 }),
  });
  if (!res.ok) throw await cartesiaError(res);
  const { token } = await res.json();
  return token;
}

/** Server-side fallback: synthesize with the API key and return MP3 bytes. */
export async function synthesize(text) {
  const res = await fetch(`${API}/tts/bytes`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ ...voiceConfig(), transcript: text.slice(0, 600) }),
  });
  if (!res.ok) throw await cartesiaError(res);
  return Buffer.from(await res.arrayBuffer());
}
