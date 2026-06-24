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

// Profiles whose avatar always presents as female (Anam asset is female).
// We force the persona's sex to "female" regardless of the photo's detected
// sex so the model picks a female voice consistently.
const FEMALE_AVATAR_PROFILES = new Set(["EVENTANAM", "EVENTANAMGRADIUM"])

function buildPersonaPrompt(
  meta: PhotoMeta,
  profile: string = DEFAULT_PROFILE,
): string {
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
  const wordCap = isEventAnam ? 45 : 30
  return (
    `You are a friendly avatar. The user can both see and hear you. ${appearance}${eventContext}` +
    "Start the conversation in English with a neutral conversational style. " +
    "If the user speaks in or asks for another language at any point, switch to that language " +
    "for the rest of the conversation. " +
    "If the user asks you to switch accent (e.g. Welsh, French, Indian, American), " +
    "change character, or change age, follow their instruction for the rest of the conversation. " +
    `Keep responses below ${wordCap} words where possible.`
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

export function avatarTalkUrl(
  meta: PhotoMeta,
  profile: string = DEFAULT_PROFILE,
): string {
  const params = new URLSearchParams({ profile })
  const fixedAvatar = FIXED_AVATAR_PROFILES.has(profile)
  if (!fixedAvatar && meta.image_url) params.set("avatar_id", meta.image_url)
  if (!fixedAvatar) {
    const voiceForProfile = CASCADING_PROFILES.has(profile)
      ? meta.voice_id || undefined
      : meta.voice_id_gemini || meta.voice_id || undefined
    if (voiceForProfile) params.set("voice_id", voiceForProfile)
  }
  // Persona prompt baked with detected age + sex + accent-change permission
  params.set("prompt", buildPersonaPrompt(meta, profile))
  // Auto-connect and return to this photo's gallery on hangup (preserving profile).
  params.set("autoconnect", "true")
  const returnQuery = new URLSearchParams({ profile })
  if (meta.id) returnQuery.set("selected", meta.id)
  const returnUrl = `${PHOTO_BASE || "/"}?${returnQuery.toString()}`
  params.set("returnurl", returnUrl)
  return `${AVATAR_APP}?${params.toString()}`
}
