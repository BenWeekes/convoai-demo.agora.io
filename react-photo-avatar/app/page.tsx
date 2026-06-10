"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"
import { PageHeader } from "@/components/PageHeader"
import {
  avatarTalkUrl,
  DEFAULT_PROFILE,
  listPhotos,
  normalizeProfile,
  type PhotoMeta,
} from "@/lib/photo"

function HomePageInner() {
  const params = useSearchParams()
  const profile = normalizeProfile(params.get("profile"))
  const initialSelected = params.get("selected") ?? null

  const [photos, setPhotos] = useState<PhotoMeta[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(initialSelected)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listPhotos(profile, 12)
      .then((list) => setPhotos(list))
      .catch(() => setPhotos([]))
      .finally(() => setLoading(false))
  }, [profile])

  // Default selection: explicit ?selected= if present, else the most recent.
  const selected = useMemo(() => {
    if (photos.length === 0) return null
    const target = selectedId ?? photos[0]?.id ?? null
    return photos.find((p) => p.id === target) ?? photos[0] ?? null
  }, [photos, selectedId])

  const hasAny = photos.length > 0
  const uploadHref =
    profile === DEFAULT_PROFILE
      ? "/upload"
      : `/upload?profile=${encodeURIComponent(profile)}`

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

            {/* Action buttons */}
            <div className="w-full flex flex-col gap-3 mt-1">
              {selected && (
                <a
                  href={avatarTalkUrl(selected, profile)}
                  className="block w-full rounded-2xl bg-white text-black py-4 text-center text-base sm:text-lg font-semibold active:scale-[0.98] transition-transform"
                >
                  💬 Talk to this avatar
                </a>
              )}
              <Link
                href={uploadHref}
                className="block w-full rounded-2xl border border-white/30 py-3 text-center text-base sm:text-lg font-medium"
              >
                📷 Upload a fresh photo
              </Link>
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
