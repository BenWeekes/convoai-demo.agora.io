"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { PageHeader } from "@/components/PageHeader"
import {
  avatarTalkUrl,
  DEFAULT_PROFILE,
  deletePhoto,
  listPhotos,
  modelVariants,
  normalizeProfile,
  type PhotoMeta,
} from "@/lib/photo"

function HomePageInner() {
  const params = useSearchParams()
  const profile = normalizeProfile(params.get("profile"))
  const initialSelected = params.get("selected") ?? null
  // Presence of ?audiopick=<vendor> flips the Talk CTA to route through
  // the voice picker (record new / pick previous / skip) instead of
  // dropping straight into the avatar call with a stock voice.
  const audiopick = params.get("audiopick") ?? ""

  // Model switcher (LemonSlice photo demo): choose which realtime MLLM the
  // avatar talks with. Variants are distinct backend profiles that share the
  // uploaded photo; only the MLLM vendor differs. Empty for other demos.
  const variants = modelVariants(profile)
  const [talkProfile, setTalkProfile] = useState<string>(
    () => variants[0]?.profile ?? profile,
  )

  const [photos, setPhotos] = useState<PhotoMeta[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(initialSelected)
  const [loading, setLoading] = useState(true)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    listPhotos(profile, 12)
      .then((list) => setPhotos(list))
      .catch(() => setPhotos([]))
      .finally(() => setLoading(false))
  }, [profile])

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
    }
  }, [])

  // Default selection: explicit ?selected= if present, else the most recent.
  const selected = useMemo(() => {
    if (photos.length === 0) return null
    const target = selectedId ?? photos[0]?.id ?? null
    return photos.find((p) => p.id === target) ?? photos[0] ?? null
  }, [photos, selectedId])

  const hasAny = photos.length > 0
  const uploadHref = (() => {
    const q = new URLSearchParams()
    if (profile !== DEFAULT_PROFILE) q.set("profile", profile)
    if (audiopick) q.set("audiopick", audiopick)
    const qs = q.toString()
    return qs ? `/upload?${qs}` : "/upload"
  })()

  // The curated seed photo (is_default:true) is shared across empty profiles
  // and isn't actually in this profile's directory, so deletion is a no-op
  // server-side — disable the button to avoid the confusing UX.
  const canDelete = !!selected?.id && !selected.is_default && !deleting

  const armDelete = () => {
    if (!canDelete) return
    if (confirmingDelete) {
      void commitDelete()
      return
    }
    setConfirmingDelete(true)
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => setConfirmingDelete(false), 4000)
  }

  const commitDelete = async () => {
    if (!selected?.id) return
    if (confirmTimer.current) {
      clearTimeout(confirmTimer.current)
      confirmTimer.current = null
    }
    setDeleting(true)
    const ok = await deletePhoto(selected.id, profile)
    setDeleting(false)
    setConfirmingDelete(false)
    if (!ok) return
    setPhotos((prev) => prev.filter((p) => p.id !== selected.id))
    setSelectedId(null)
    // Re-pull so the server-side seed reappears if the gallery just emptied.
    void listPhotos(profile, 12).then((list) => setPhotos(list))
  }

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <PageHeader profile={profile} />
      <main
        className="flex-1 flex flex-col items-center px-5 pt-4 gap-4 max-w-md mx-auto w-full"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}
      >
        {!loading && !hasAny && (
          <div className="w-full text-center mt-6">
            <h1 className="text-2xl font-semibold leading-tight mb-2">
              Snap a photo. Talk to your avatar.
            </h1>
            <p className="text-white/70 text-sm mb-6">
              Upload any photo and we&apos;ll turn it into a live video avatar
              you can talk to.
            </p>
            <Link
              href={uploadHref}
              className="block w-full rounded-2xl bg-white text-black py-4 text-base font-semibold"
            >
              📷 Upload a Photo
            </Link>
          </div>
        )}

        {hasAny && (
          <>
            {/* Hero — currently selected photo */}
            <div className="w-full flex flex-col items-center gap-3">
              <p className="text-xs uppercase tracking-wider text-white/40">
                Selected avatar
              </p>
              {selected?.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.image_url}
                  alt="Selected avatar"
                  className="w-44 h-44 sm:w-56 sm:h-56 rounded-2xl object-cover"
                />
              ) : (
                <div className="w-44 h-44 sm:w-56 sm:h-56 rounded-2xl bg-white/5" />
              )}
            </div>

            {/* Model switcher — only for demos with MLLM variants (LemonSlice photo) */}
            {variants.length > 1 && !audiopick && (
              <label className="w-full flex items-center justify-between gap-3 rounded-2xl border border-white/20 px-4 py-3">
                <span className="text-sm text-white/70">Model</span>
                <select
                  value={talkProfile}
                  onChange={(e) => setTalkProfile(e.target.value)}
                  className="bg-transparent text-right text-sm font-medium text-white focus:outline-none"
                >
                  {variants.map((v) => (
                    <option key={v.profile} value={v.profile} className="bg-black text-white">
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* Action buttons — single row of three to save vertical space */}
            <div className="w-full grid grid-cols-3 gap-2 mt-1">
              {selected ? (
                audiopick ? (
                  <Link
                    href={`/voice-picker?profile=${encodeURIComponent(profile)}&photo_id=${encodeURIComponent(selected.id ?? "")}&audiopick=${encodeURIComponent(audiopick)}`}
                    className="rounded-2xl bg-white text-black py-4 text-center text-sm sm:text-base font-semibold active:scale-[0.98] transition-transform"
                  >
                    🎤 Pick voice
                  </Link>
                ) : (
                  <a
                    href={avatarTalkUrl(selected, talkProfile)}
                    className="rounded-2xl bg-white text-black py-4 text-center text-sm sm:text-base font-semibold active:scale-[0.98] transition-transform"
                  >
                    💬 Talk
                  </a>
                )
              ) : (
                <div />
              )}
              <Link
                href={uploadHref}
                className="rounded-2xl border border-white/30 py-4 text-center text-sm sm:text-base font-medium active:scale-[0.98] transition-transform"
              >
                📷 Upload
              </Link>
              <button
                type="button"
                onClick={armDelete}
                disabled={!canDelete}
                className={
                  "rounded-2xl py-4 text-center text-sm sm:text-base font-medium active:scale-[0.98] transition-transform " +
                  (confirmingDelete
                    ? "bg-red-600 text-white"
                    : "border border-white/30 text-white disabled:opacity-30")
                }
                aria-label={
                  confirmingDelete ? "Confirm delete" : "Delete photo"
                }
              >
                {deleting
                  ? "Deleting…"
                  : confirmingDelete
                    ? "Confirm?"
                    : "🗑 Delete"}
              </button>
            </div>

            {/* 4 × 3 grid of recent uploads */}
            <div className="w-full mt-3">
              <p className="text-xs uppercase tracking-wider text-white/40 mb-2 text-center">
                Recent uploads
              </p>
              <div className="grid grid-cols-4 gap-2">
                {photos.map((p) => {
                  const isSel = p.id === selected?.id
                  return (
                    <button
                      key={p.id ?? ""}
                      onClick={() => setSelectedId(p.id)}
                      className={
                        "aspect-square rounded-lg overflow-hidden transition-opacity " +
                        (isSel
                          ? "ring-2 ring-white opacity-100"
                          : "opacity-70 hover:opacity-100")
                      }
                      aria-label={
                        isSel
                          ? "Currently selected"
                          : "Select this avatar"
                      }
                    >
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.image_url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-white/5" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <HomePageInner />
    </Suspense>
  )
}
