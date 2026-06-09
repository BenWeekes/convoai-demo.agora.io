// Shared helpers and the redirect to the avatar talk page.

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "/simple-backend"
const AVATAR_APP = process.env.NEXT_PUBLIC_AVATAR_APP_URL || "/react-video-client-avatar"
const PHOTO_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ""

export type PhotoMeta = {
  id: string | null
  image_url: string | null
  sex: "male" | "female" | null
  age_bucket: "young" | "middle" | "mature" | null
  voice_id: string | null
  uploaded_at?: number
}

export async function uploadPhoto(file: File): Promise<PhotoMeta> {
  const form = new FormData()
  form.append("photo", file)
  const res = await fetch(`${BACKEND}/upload-photo`, { method: "POST", body: form })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(text || `upload failed (${res.status})`)
  }
  return (await res.json()) as PhotoMeta
}

export async function getLatest(): Promise<PhotoMeta> {
  const res = await fetch(`${BACKEND}/photo-latest`, { cache: "no-store" })
  return (await res.json()) as PhotoMeta
}

export async function getPhoto(id: string): Promise<PhotoMeta | null> {
  const res = await fetch(`${BACKEND}/photo/${encodeURIComponent(id)}`, { cache: "no-store" })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`fetch failed (${res.status})`)
  return (await res.json()) as PhotoMeta
}

export function avatarTalkUrl(meta: PhotoMeta): string {
  const params = new URLSearchParams({ profile: "PHOTO" })
  if (meta.image_url) params.set("avatar_id", meta.image_url)
  if (meta.voice_id) params.set("voice_id", meta.voice_id)
  // Auto-connect into the call and return to this photo's result page on hangup.
  params.set("autoconnect", "true")
  const returnUrl = meta.id
    ? `${PHOTO_BASE}/result/${meta.id}`
    : PHOTO_BASE || "/"
  params.set("returnurl", returnUrl)
  return `${AVATAR_APP}?${params.toString()}`
}
