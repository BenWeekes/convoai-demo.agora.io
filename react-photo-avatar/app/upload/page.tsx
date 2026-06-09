"use client"

import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { PageHeader } from "@/components/PageHeader"
import { uploadPhoto } from "@/lib/photo"

export default function UploadPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
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
    setError(null)
    try {
      const meta = await uploadPhoto(file)
      if (!meta.id) throw new Error("upload returned no id")
      router.push(`/result/${meta.id}`)
    } catch (err) {
      setError((err as Error).message || "upload failed")
      setUploading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <PageHeader />
      <main
        className="flex-1 flex flex-col items-center px-5 pt-5 gap-4 max-w-md mx-auto w-full"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}
      >
        <h1 className="text-xl sm:text-2xl font-semibold text-center">Upload your photo</h1>

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
            className="w-full rounded-2xl bg-white text-black py-4 text-base sm:text-lg font-semibold disabled:opacity-30 active:scale-[0.98] transition-transform"
          >
            {uploading ? "Uploading…" : "Use this photo"}
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
