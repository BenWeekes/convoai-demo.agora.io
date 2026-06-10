"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useRef, useState } from "react"
import { PageHeader } from "@/components/PageHeader"
import {
  DEFAULT_PROFILE,
  normalizeProfile,
  uploadPhoto,
} from "@/lib/photo"

function UploadPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const profile = normalizeProfile(searchParams.get("profile"))

  const fileRef = useRef<HTMLInputElement | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setError(null)
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(f)
  }

  const onSubmit = async () => {
    if (!file) return
    setUploading(true)
    setProgress(0)
    setError(null)
    try {
      const meta = await uploadPhoto(file, profile, {
        onProgress: setProgress,
      })
      if (!meta.id) throw new Error("upload returned no id")
      const q = new URLSearchParams()
      if (profile !== DEFAULT_PROFILE) q.set("profile", profile)
      q.set("selected", meta.id)
      router.push(`/?${q.toString()}`)
    } catch (err) {
      setError((err as Error).message || "upload failed")
      setUploading(false)
      setProgress(0)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <PageHeader profile={profile} />
      <main
        className="flex-1 flex flex-col items-center px-5 pt-5 gap-4 max-w-md mx-auto w-full"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}
      >
        <h1 className="text-xl sm:text-2xl font-semibold text-center">Upload your photo</h1>
        {profile !== DEFAULT_PROFILE && (
          <p className="text-xs text-white/40 uppercase tracking-wider">
            profile: {profile}
          </p>
        )}

        <div
          className="w-full max-h-[40vh] aspect-square rounded-2xl border-2 border-dashed border-white/20 flex items-center justify-center overflow-hidden bg-white/5"
          onClick={() => fileRef.current?.click()}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="preview" className="w-full h-full object-cover" />
          ) : (
            <div className="text-center text-white/50 px-6">
              <p className="text-5xl mb-2">📷</p>
              <p>Tap to choose a photo</p>
              <p className="text-xs mt-2">(or take one with your camera)</p>
            </div>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="hidden"
          onChange={onFile}
        />

        {error && (
          <p className="text-sm text-red-400 text-center w-full">{error}</p>
        )}

        <div className="w-full flex flex-col gap-3 mt-auto">
          <button
            type="button"
            onClick={onSubmit}
            disabled={!file || uploading}
            className="relative w-full overflow-hidden rounded-2xl bg-white/15 text-black py-4 text-base sm:text-lg font-semibold disabled:opacity-40 active:scale-[0.98] transition-transform"
          >
            {/* White fill grows left→right with upload progress. When idle or
                errored, fill is full so the button reads as a normal white CTA. */}
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-white transition-[width] duration-100"
              style={{
                width: uploading ? `${Math.round(progress * 100)}%` : "100%",
              }}
            />
            <span className="relative">
              {uploading
                ? `Uploading ${Math.round(progress * 100)}%`
                : error
                  ? "Retry"
                  : "Use this photo"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-2xl border border-white/30 py-3 text-base sm:text-lg font-medium"
          >
            Choose a different photo
          </button>
        </div>
      </main>
    </div>
  )
}

export default function UploadPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <UploadPageInner />
    </Suspense>
  )
}
