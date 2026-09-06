// Shared helpers and the redirect to the avatar talk page.

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "/simple-backend"
const AVATAR_APP = process.env.NEXT_PUBLIC_AVATAR_APP_URL || "/react-video-client-avatar"
const PHOTO_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ""

// Default profile when the page URL has no ?profile= override. Switchable at
// build time via NEXT_PUBLIC_PHOTO_PROFILE.
export const DEFAULT_PROFILE =
  process.env.NEXT_PUBLIC_PHOTO_PROFILE || "PHOTO_GEMINI"

export function normalizeProfile(p: string | null | undefined): string {
  if (!p) return DEFAULT_PROFILE
  const cleaned = p.replace(/[^A-Za-z0-9_]/g, "").toUpperCase()
  return cleaned || DEFAULT_PROFILE
}

export type PhotoMeta = {
  id: string | null
  profile?: string | null
  image_url: string | null
  sex: "male" | "female" | null
  age_bucket: "young" | "middle" | "mature" | null
  voice_id: string | null              // ElevenLabs voice id (PHOTO profile)
  voice_id_gemini?: string | null      // Gemini Live voice (PHOTO_GEMINI / EVENTDEMO)
  uploaded_at?: number
  is_default?: boolean                 // True for the curated empty-profile seed
}

export async function uploadPhoto(
  file: File,
  profile: string = DEFAULT_PROFILE,
  opts: { timeoutMs?: number; onProgress?: (fraction: number) => void } = {},
): Promise<PhotoMeta> {
  const { timeoutMs = 25000, onProgress } = opts
  // XMLHttpRequest gives us upload-byte progress (fetch doesn't). Hard timeout
  // surfaces a stalled 5G handshake as an error so the caller's catch fires
  // and re-enables the button instead of hanging forever.
  return new Promise<PhotoMeta>((resolve, reject) => {
    const form = new FormData()
    form.append("photo", file)
    const xhr = new XMLHttpRequest()
    xhr.open(
      "POST",
      `${BACKEND}/upload-photo?profile=${encodeURIComponent(profile)}`,
    )
    xhr.timeout = timeoutMs
    xhr.responseType = "json"
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.max(0, Math.min(1, e.loaded / e.total)))
      }
    }
    xhr.upload.onload = () => onProgress?.(1)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as PhotoMeta)
      } else {
        const msg =
          (xhr.response && (xhr.response as { error?: string }).error) ||
          `Upload failed (${xhr.status})`
        reject(new Error(msg))
      }
    }
    xhr.onerror = () => reject(new Error("Network error. Retry."))
    xhr.ontimeout = () => reject(new Error("Upload timed out. Retry."))
    xhr.send(form)
  })
}

export async function getLatest(
  profile: string = DEFAULT_PROFILE,
): Promise<PhotoMeta> {
  const res = await fetch(
    `${BACKEND}/photo-latest?profile=${encodeURIComponent(profile)}`,
    { cache: "no-store" },
  )
  return (await res.json()) as PhotoMeta
}

export async function getPhoto(
  id: string,
  profile: string = DEFAULT_PROFILE,
): Promise<PhotoMeta | null> {
  const res = await fetch(
    `${BACKEND}/photo/${encodeURIComponent(id)}?profile=${encodeURIComponent(profile)}`,
    { cache: "no-store" },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`fetch failed (${res.status})`)
  return (await res.json()) as PhotoMeta
}

export async function deletePhoto(
  id: string,
  profile: string = DEFAULT_PROFILE,
): Promise<boolean> {
  const res = await fetch(
    `${BACKEND}/photo/${encodeURIComponent(id)}?profile=${encodeURIComponent(profile)}`,
    { method: "DELETE" },
  )
  return res.ok || res.status === 404
}

export async function listPhotos(
  profile: string = DEFAULT_PROFILE,
  limit = 12,
): Promise<PhotoMeta[]> {
  const res = await fetch(
    `${BACKEND}/photos?profile=${encodeURIComponent(profile)}&limit=${limit}`,
    { cache: "no-store" },
  )
  if (!res.ok) return []
  return (await res.json()) as PhotoMeta[]
}

// Voice clone sidecar — mirrors PhotoMeta shape but keyed by datetime slug.
export type VoiceMeta = {
  id: string                    // datetime slug "YYYY-MM-DD-HHMMSS"
  voice_id: string              // vendor's cloned voice id
  vendor: string                // "gradium" for now
  created_at: number            // unix seconds
  created_at_iso?: string
  sample_bytes?: number
  sample_mime?: string
  sample_url: string            // e.g. /photo-uploads/<P>/voices/<slug>.wav
  note?: string                 // e.g. "Please wait a bit till the voice is ready to be used."
}

// Resolve the API base URL of the served sample. `sample_url` is a
// server-absolute path ("/photo-uploads/...") — nginx serves it directly
// off the same host.
export function voiceSampleUrl(meta: VoiceMeta): string {
  return meta.sample_url.startsWith("http")
    ? meta.sample_url
    : `${typeof window !== "undefined" ? window.location.origin : ""}${meta.sample_url}`
}

export async function listVoices(
  profile: string = DEFAULT_PROFILE,
  limit = 12,
): Promise<VoiceMeta[]> {
  const res = await fetch(
    `${BACKEND}/voices?profile=${encodeURIComponent(profile)}&limit=${limit}`,
    { cache: "no-store" },
  )
  if (!res.ok) return []
  return (await res.json()) as VoiceMeta[]
}

export async function deleteVoice(
  slug: string,
  profile: string = DEFAULT_PROFILE,
): Promise<boolean> {
  const res = await fetch(
    `${BACKEND}/voice/${encodeURIComponent(slug)}?profile=${encodeURIComponent(profile)}`,
    { method: "DELETE" },
  )
  return res.ok || res.status === 404
}

export async function submitCloneVoice(
  profile: string,
  audio: Blob,
  opts: { vendor?: string; timeoutMs?: number; onProgress?: (fraction: number) => void } = {},
): Promise<VoiceMeta> {
  const { vendor = "gradium", timeoutMs = 90_000, onProgress } = opts
  return new Promise<VoiceMeta>((resolve, reject) => {
    const form = new FormData()
    // Pick the extension from the file name first (uploads), then the mime
    // (recordings). Covers recordings (webm/ogg) and uploads (mp3/m4a/wav).
    const t = (audio.type || "").toLowerCase()
    const nameExt = ((audio as File).name || "").match(/\.(mp3|m4a|mp4|aac|wav|webm|ogg)$/i)?.[1]?.toLowerCase()
    const ext =
      nameExt ? (nameExt === "mp4" || nameExt === "aac" ? "m4a" : nameExt)
      : /webm/.test(t) ? "webm"
      : /ogg/.test(t) ? "ogg"
      : /mpeg|mp3/.test(t) ? "mp3"
      : /mp4|m4a|aac/.test(t) ? "m4a"
      : "wav"
    // Some browsers give an m4a File an empty type; re-wrap so the multipart
    // part carries a Content-Type the backend accepts.
    const mimeForExt: Record<string, string> = {
      mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", webm: "audio/webm", ogg: "audio/ogg",
    }
    const blob = /^audio\//.test(t) ? audio : new Blob([audio], { type: mimeForExt[ext] || "audio/mpeg" })
    form.append("audio", blob, `sample.${ext}`)
    const xhr = new XMLHttpRequest()
    xhr.open(
      "POST",
      `${BACKEND}/clone-voice?profile=${encodeURIComponent(profile)}&vendor=${encodeURIComponent(vendor)}`,
    )
    xhr.timeout = timeoutMs
    xhr.responseType = "json"
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response) return resolve(xhr.response as VoiceMeta)
      const err = xhr.response?.error || `HTTP ${xhr.status}`
      reject(new Error(err))
    }
    xhr.onerror = () => reject(new Error("network error"))
    xhr.ontimeout = () => reject(new Error("timeout"))
    xhr.send(form)
  })
}

// Profiles whose avatar always presents as female (Anam asset is female).
// We force the persona's sex to "female" regardless of the photo's detected
// sex so the model picks a female voice consistently.
const FEMALE_AVATAR_PROFILES = new Set(["EVENTANAM", "EVENTANAMGRADIUM"])

// Profiles that use a fixed event/demo script instead of the
// photo-derived persona composition. Bypass the sex/age builder and
// hand the model a self-contained prompt.
const FIXED_PROMPT: Record<string, string> = {
  GRADIUMDEMO:
    "You are a talking avatar at Raise AI summit running Gradium TTS " +
    "and Agora ConvoAI for high quality, low latency voice interactions. " +
    "Keep responses between 10 to 20 words and try and make people laugh. " +
    "The user may speak in English or French — always reply in whichever " +
    "of those two languages the user's most recent message was in, and " +
    "switch language as soon as they do.",
}

function buildPersonaPrompt(
  meta: PhotoMeta,
  profile: string = DEFAULT_PROFILE,
): string {
  const fixed = FIXED_PROMPT[profile]
  if (fixed) return fixed
  const age =
    meta.age_bucket === "young"
      ? "young"
      : meta.age_bucket === "mature"
        ? "older"
        : meta.age_bucket === "middle"
          ? "middle-aged"
          : ""
  const sex = FEMALE_AVATAR_PROFILES.has(profile)
    ? "female"
    : meta.sex ?? ""
  const persona = [age, sex].filter(Boolean).join(" ")
  const isEventAnam = profile === "EVENTANAM"
  const voiceStyle = isEventAnam
    ? `Always speak in a warm, natural ${sex || "female"} voice with normal volume and pacing. ` +
      "Only switch into a whisper if the user explicitly asks you to whisper — when they do, drop " +
      "almost fully into a whisper for the rest of the conversation until they ask otherwise. " +
      "Do not switch to a male voice. "
    : `Always speak in a warm, natural ${sex || ""} voice and do not switch to a male voice. `
  const appearance = persona
    ? `You appear as a ${persona} person. ${voiceStyle}`
    : ""
  const eventContext = isEventAnam
    ? "Context: you are live on stage in Barcelona, Spain, at the Voice AI Space Barcelona event, " +
      "being presented to the audience as a demo. Acknowledge the location and event naturally when " +
      "it fits, and feel free to greet the room. Spanish or Catalan replies are welcome if the user " +
      "switches. "
    : ""
  const wordCap = isEventAnam ? 45 : 60
  // Event mode (all EVENTDEMO_* models): an excited Agora Conversational AI salesperson.
  const isEvent = profile.startsWith("EVENTDEMO")
  const agoraPitch = isEvent
    ? "You are at a live event representing Agora, and you are genuinely excited to sell people on " +
      "Agora's Conversational AI. Speak with warmth and infectious, upbeat energy, and keep it FRESH " +
      "and VARIED — each time you speak, pick a DIFFERENT angle you have not just covered, and use a " +
      "vivid concrete example rather than repeating yourself. " +
      "Why it's great: ultra-low latency (around 3x faster responses than typical LLM voice modes) with " +
      "real-time interruption handling, noise suppression and echo cancellation, all running on Agora's " +
      "global SD-RTN so it stays smooth even on poor networks. It runs on ANY device and OS — in the " +
      "browser and native on iOS, Android and desktop. It is fully interoperable: mix and match any " +
      "speech-to-text (Ares, Deepgram, Azure), any text-to-speech (ElevenLabs, Cartesia, OpenAI, Hume), " +
      "any LLM or realtime multimodal model (OpenAI, Gemini, xAI, Anthropic, Vertex, or your own), and " +
      "avatars from any provider (HeyGen, Anam, Akool, Trulience, or a single photo like me). " +
      "Rotate through real use cases across industries — healthcare and companionship, education and " +
      "tutoring, social apps, live sports commentary, recruitment and interviewing, entertainment and " +
      "game characters, and customer support. Proactively bring these up, give examples, and keep " +
      "steering back to Agora. "
    : ""
  return (
    `You are a friendly avatar. The user can both see and hear you. ${appearance}${agoraPitch}${eventContext}` +
    "Start the conversation in English with a neutral conversational style. " +
    "If the user speaks in or asks for another language at any point, switch to that language " +
    "for the rest of the conversation. " +
    "If the user asks you to switch accent (e.g. Welsh, French, Indian, American), " +
    "change character, or change age, follow their instruction for the rest of the conversation. " +
    `Aim for natural, conversational replies of up to about ${wordCap} words — when a topic is ` +
    "interesting, feel free to elaborate and share a bit more rather than keeping it terse; " +
    "just avoid rambling much past that."
  )
}

// Profiles that use cascading TTS (ElevenLabs) and want the long voice_id.
// Everything else is assumed to use a realtime MLLM (Gemini) with short
// voice names — fall back to voice_id_gemini first to avoid sending an
// ElevenLabs ID to Gemini Live.
const CASCADING_PROFILES = new Set(["PHOTO", "LES"])

// Profiles whose avatar + voice are pinned at the backend (vendor needs a
// UUID, not a photo URL — e.g. Anam — and the voice must match the MLLM
// vendor on the profile). Talk URLs for these profiles intentionally do NOT
// pass avatar_id / voice_id, so the backend uses its profile defaults. The
// gallery photo still drives the persona prompt (sex / age detection).
const FIXED_AVATAR_PROFILES = new Set(["EVENTANAM", "EVENTANAMGRADIUM"])

// Profiles that pass a stock Gradium voice_id picked from meta.sex. The
// backend's gradium branch already accepts voice_id as a query-param
// override, so we just resolve the ID client-side and pipe it through.
// Adding a profile here is enough to route it through pickGradiumVoice()
// — no schema change.
const GRADIUM_PROFILES = new Set(["GRADIUMDEMO"])

// Model switch for the LemonSlice photo demo: same avatar (the uploaded photo),
// different realtime MLLM vendor. Each variant is a distinct backend profile
// that shares EVENTDEMO's LemonSlice avatar config and only swaps the MLLM.
export type ModelVariant = { label: string; profile: string }
export const MODEL_VARIANTS: Record<string, ModelVariant[]> = {
  EVENTDEMO: [
    { label: "Gemini Live", profile: "EVENTDEMO" },
    { label: "GPT Live", profile: "EVENTDEMO_GPT" },
    { label: "GPT Realtime", profile: "EVENTDEMO_GPTRT" },
    { label: "Grok · xAI", profile: "EVENTDEMO_XAI" },
  ],
}
export function modelVariants(profile: string): ModelVariant[] {
  return MODEL_VARIANTS[profile] ?? []
}

// Realtime profiles whose MLLM supplies its OWN voice from the profile's
// MLLM_VOICE. Don't pass a photo-derived voice_id — that's a Gemini/ElevenLabs
// voice name the OpenAI (GPT Live) / xAI realtime models don't recognise.
const PROFILE_OWN_VOICE = new Set(["EVENTDEMO_GPT", "EVENTDEMO_GPTRT", "EVENTDEMO_XAI"])

const GRADIUM_STOCK_VOICES = {
  male:   "_6Aslh2DxfmnRLmP",
  female: "cLONiZ4hQ8VpQ4Sz",
} as const
const GRADIUM_DEFAULT_VOICE = GRADIUM_STOCK_VOICES.male

function pickGradiumVoice(sex: PhotoMeta["sex"]): string {
  return sex === "male" || sex === "female"
    ? GRADIUM_STOCK_VOICES[sex]
    : GRADIUM_DEFAULT_VOICE
}

export function avatarTalkUrl(
  meta: PhotoMeta,
  profile: string = DEFAULT_PROFILE,
  opts: { voiceIdOverride?: string; audiopick?: string } = {},
): string {
  const params = new URLSearchParams({ profile })
  const fixedAvatar = FIXED_AVATAR_PROFILES.has(profile)
  if (!fixedAvatar && meta.image_url) params.set("avatar_id", meta.image_url)
  if (!fixedAvatar && !PROFILE_OWN_VOICE.has(profile)) {
    // Explicit override (voice picker resolved a clone) always wins,
    // otherwise fall through the existing per-profile fallback chain.
    const voiceForProfile = opts.voiceIdOverride
      ?? (GRADIUM_PROFILES.has(profile) ? pickGradiumVoice(meta.sex) : undefined)
      ?? (CASCADING_PROFILES.has(profile) ? meta.voice_id || undefined : undefined)
      ?? meta.voice_id_gemini
      ?? meta.voice_id
      ?? undefined
    if (voiceForProfile) params.set("voice_id", voiceForProfile)
  }
  // Persona prompt baked with detected age + sex + accent-change permission
  params.set("prompt", buildPersonaPrompt(meta, profile))
  // Auto-connect and return to this photo's gallery on hangup (preserving profile).
  params.set("autoconnect", "true")
  const returnQuery = new URLSearchParams({ profile })
  if (meta.id) returnQuery.set("selected", meta.id)
  // Preserve audiopick so a hangup drops the user back into the same
  // voice-picker flow instead of the default gallery.
  if (opts.audiopick) returnQuery.set("audiopick", opts.audiopick)
  const returnUrl = `${PHOTO_BASE || "/"}?${returnQuery.toString()}`
  params.set("returnurl", returnUrl)
  return `${AVATAR_APP}?${params.toString()}`
}
