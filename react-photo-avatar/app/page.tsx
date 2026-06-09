"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { PageHeader } from "@/components/PageHeader"
import { avatarTalkUrl, getLatest, type PhotoMeta } from "@/lib/photo"

export default function HomePage() {
  const [latest, setLatest] = useState<PhotoMeta | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getLatest()
      .then((m) => setLatest(m))
      .catch(() => setLatest(null))
      .finally(() => setLoading(false))
  }, [])

  const hasLatest = !!latest?.image_url

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <PageHeader />
      <main
        className="flex-1 flex flex-col items-center px-5 pt-6 gap-5 max-w-md mx-auto w-full"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}
      >
        <h1 className="text-2xl sm:text-3xl font-semibold text-center leading-tight">
          Snap a photo. Talk to your avatar.
        </h1>
        <p className="text-center text-white/70 text-sm sm:text-base">
          Upload any photo of yourself. We&apos;ll turn it into a live video avatar
          you can talk to.
        </p>

        <div className="w-full flex flex-col gap-3 mt-2">
          <Link
            href="/upload"
            className="block w-full rounded-2xl bg-white text-black py-4 text-center text-base sm:text-lg font-semibold active:scale-[0.98] transition-transform"
          >
            📷 Upload a Photo
          </Link>

          {hasLatest ? (
            <a
              href={avatarTalkUrl(latest!)}
              className="block w-full rounded-2xl py-4 text-center text-base sm:text-lg font-semibold border border-white/30 text-white"
            >
              💬 Talk to Avatar
            </a>
          ) : (
            <Link
              href="/upload"
              className="block w-full rounded-2xl py-4 text-center text-base sm:text-lg font-semibold border border-white/10 text-white/40"
            >
              💬 Talk to Avatar
              {!loading && (
                <span className="block text-xs font-normal mt-1">
                  (upload a photo first)
                </span>
              )}
            </Link>
          )}
        </div>

        {hasLatest && latest?.image_url && (
          <div className="mt-4 text-center">
            <p className="text-xs uppercase tracking-wider text-white/40 mb-2">
              Latest upload
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={latest.image_url}
              alt="Latest uploaded avatar"
              className="w-24 h-24 sm:w-32 sm:h-32 rounded-2xl object-cover mx-auto"
            />
          </div>
        )}
      </main>
    </div>
  )
}
