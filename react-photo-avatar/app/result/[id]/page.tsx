"use client"

import Link from "next/link"
import { use, useEffect, useState } from "react"
import { PageHeader } from "@/components/PageHeader"
import { avatarTalkUrl, getPhoto, type PhotoMeta } from "@/lib/photo"

export default function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [meta, setMeta] = useState<PhotoMeta | null | "missing">(null)

  useEffect(() => {
    getPhoto(id)
      .then((m) => setMeta(m ?? "missing"))
      .catch(() => setMeta("missing"))
  }, [id])

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <PageHeader />
      <main
        className="flex-1 flex flex-col items-center px-5 pt-5 gap-4 max-w-md mx-auto w-full"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}
      >
        {meta === null && <p className="text-white/60">Loading…</p>}

        {meta === "missing" && (
          <>
            <h1 className="text-2xl font-semibold text-center">Photo not found</h1>
            <Link
              href="/upload"
              className="w-full rounded-2xl bg-white text-black py-4 text-center text-lg font-semibold"
            >
              Upload a new photo
            </Link>
          </>
        )}

        {meta && meta !== "missing" && (
          <>
            <h1 className="text-xl sm:text-2xl font-semibold text-center">Meet your avatar</h1>

            {meta.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={meta.image_url}
                alt="Your avatar"
                className="w-40 h-40 sm:w-56 sm:h-56 rounded-2xl object-cover"
              />
            )}

            <div className="w-full flex flex-col gap-3 mt-auto">
              <a
                href={avatarTalkUrl(meta)}
                className="w-full rounded-2xl bg-white text-black py-4 text-center text-base sm:text-lg font-semibold active:scale-[0.98] transition-transform"
              >
                💬 Talk to Me
              </a>
              <Link
                href="/upload"
                className="w-full rounded-2xl border border-white/30 py-3 text-center text-base sm:text-lg font-medium"
              >
                Upload a different photo
              </Link>
              <Link
                href="/"
                className="w-full text-center text-xs text-white/40 py-1"
              >
                Back to home
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
