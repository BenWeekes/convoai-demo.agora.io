"use client"

import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { PageHeader } from "@/components/PageHeader"
import {
  avatarTalkUrl,
  DEFAULT_PROFILE,
  deleteVoice,
  getPhoto,
  listVoices,
  normalizeProfile,
  submitCloneVoice,
  voiceSampleUrl,
  type PhotoMeta,
  type VoiceMeta,
} from "@/lib/photo"

function formatSlug(slug: string): string {
  // slug is "YYYY-MM-DD-HHMMSS"
  const m = slug.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/)
  if (!m) return slug
  const [, y, mo, d, h, mi, s] = m
  return `${y}-${mo}-${d}  ${h}:${mi}:${s} UTC`
}

const MAX_RECORD_MS = 30_000

function VoicePickerInner() {
  const router = useRouter()
  const params = useSearchParams()
  const profile = normalizeProfile(params.get("profile"))
  const photoId = params.get("photo_id") || ""
  const audiopick = params.get("audiopick") || "GRADIUM"

  const [photo, setPhoto] = useState<PhotoMeta | null>(null)
  const [voices, setVoices] = useState<VoiceMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Recording state
  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [recordedDurationMs, setRecordedDurationMs] = useState<number>(0)
  const [submitting, setSubmitting] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const recordStartRef = useRef<number>(0)
  const autostopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [nowLabel, setNowLabel] = useState<string>("")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [p, v] = await Promise.all([
          photoId ? getPhoto(photoId, profile) : Promise.resolve(null),
          listVoices(profile, 12),
        ])
        if (cancelled) return
        setPhoto(p)
        setVoices(v)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [profile, photoId])

  // Ticking clock label — the current UTC timestamp becomes the clone's slug.
  useEffect(() => {
    const tick = () => {
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, "0")
      setNowLabel(
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}  ` +
          `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`,
      )
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const goTalk = (voiceIdOverride?: string) => {
    if (!photo) return
    const url = avatarTalkUrl(photo, profile, { voiceIdOverride, audiopick })
    // Hard nav — /photo-call is a sibling Next.js app under a different
    // basePath. router.push would prefix /photo (this app's basePath)
    // and produce /photo/photo-call → 404. window.location keeps the
    // URL verbatim, matching how the gallery <a href=…> already does it.
    window.location.href = url
  }

  const backToGallery = () => {
    const q = new URLSearchParams()
    if (profile !== DEFAULT_PROFILE) q.set("profile", profile)
    if (photoId) q.set("selected", photoId)
    q.set("audiopick", audiopick)
    router.push(`/?${q.toString()}`)
  }

  const clearTimers = () => {
    if (autostopRef.current) {
      clearTimeout(autostopRef.current)
      autostopRef.current = null
    }
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }

  const startRecording = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      // Prefer webm/opus (widely supported); fall back to browser default.
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : ""
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        clearTimers()
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" })
        setRecordedBlob(blob)
        setRecordedUrl(URL.createObjectURL(blob))
        setRecordedDurationMs(Date.now() - recordStartRef.current)
        setElapsedMs(0)
        stream.getTracks().forEach((t) => t.stop())
      }
      recorderRef.current = rec
      recordStartRef.current = Date.now()
      setElapsedMs(0)
      rec.start()
      setRecording(true)
      // Auto-stop at MAX_RECORD_MS so we don't over-consume Gradium clone
      // input and so the UI can't run past the visible cap.
      autostopRef.current = setTimeout(() => {
        if (recorderRef.current?.state === "recording") {
          recorderRef.current.stop()
        }
        recorderRef.current = null
        setRecording(false)
      }, MAX_RECORD_MS)
      // 100 ms tick keeps the countdown label live enough to feel accurate
      // without floating point jitter — MediaRecorder itself doesn't publish
      // an elapsed-time event.
      tickRef.current = setInterval(() => {
        const ms = Date.now() - recordStartRef.current
        setElapsedMs(Math.min(ms, MAX_RECORD_MS))
      }, 100)
    } catch (e) {
      setError(`Microphone access failed: ${(e as Error).message}`)
    }
  }

  const stopRecording = () => {
    // If the auto-stop fired first, the recorder is already null — bail so
    // we don't call stop() twice.
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop()
    }
    recorderRef.current = null
    setRecording(false)
    clearTimers()
  }

  // Cleanup: cancel timers + release stream if the user navigates away
  // mid-record. Without this the mic light stays on until GC.
  useEffect(() => {
    return () => {
      clearTimers()
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop()
      }
    }
  }, [])

  const resetRecording = () => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    setRecordedBlob(null)
    setRecordedUrl(null)
    setRecordedDurationMs(0)
  }

  // Upload an existing audio file (mp3/m4a/wav) instead of recording — it
  // feeds the exact same preview + clone flow as a recording.
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-picking the same file
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setError("File too large — max 8 MB.")
      return
    }
    const okType = /audio\/(mpeg|mp3|mp4|x-m4a|m4a|aac|wav|wave|x-wav|webm|ogg)/i.test(file.type)
    const okName = /\.(mp3|m4a|mp4|aac|wav|webm|ogg)$/i.test(file.name)
    if (!okType && !okName) {
      setError("Please choose an MP3, M4A or WAV file.")
      return
    }
    if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    const url = URL.createObjectURL(file)
    setRecordedBlob(file)
    setRecordedUrl(url)
    setRecordedDurationMs(0)
    setError(null)
    // Best-effort duration for the label (uploads have no record timer).
    const probe = new Audio()
    probe.preload = "metadata"
    probe.onloadedmetadata = () => {
      if (isFinite(probe.duration)) setRecordedDurationMs(Math.round(probe.duration * 1000))
    }
    probe.src = url
  }

  const submitClone = async () => {
    if (!recordedBlob) return
    setSubmitting(true)
    setError(null)
    try {
      const clone = await submitCloneVoice(profile, recordedBlob, { vendor: "gradium" })
      // Add the new clone to the top of the list so the user sees confirmation
      setVoices((prev) => [clone, ...prev])
      resetRecording()
      goTalk(clone.voice_id)
    } catch (e) {
      setError(`Clone failed: ${(e as Error).message}`)
      setSubmitting(false)
    }
  }

  const secs = useMemo(() => Math.round(recordedDurationMs / 100) / 10, [recordedDurationMs])
  const gridEmpty = voices.length === 0

  // Two-click delete: first click on a card arms it (its "×" flips to a
  // red "Delete?" for 4 s). Second click within that window commits.
  // Matches the confirm pattern the photo gallery uses.
  const [armedDelete, setArmedDelete] = useState<string | null>(null)
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null)
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
  }, [])
  const onDeleteClick = async (slug: string) => {
    if (armedDelete !== slug) {
      setArmedDelete(slug)
      if (armTimerRef.current) clearTimeout(armTimerRef.current)
      armTimerRef.current = setTimeout(() => setArmedDelete(null), 4000)
      return
    }
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current)
      armTimerRef.current = null
    }
    setArmedDelete(null)
    setDeletingSlug(slug)
    const ok = await deleteVoice(slug, profile)
    setDeletingSlug(null)
    if (ok) setVoices((prev) => prev.filter((v) => v.id !== slug))
    else setError(`Failed to delete ${slug}`)
  }

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <PageHeader profile={profile} />
      <main
        className="flex-1 flex flex-col items-center px-5 pt-5 gap-4 max-w-2xl mx-auto w-full"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}
      >
        <h1 className="text-xl sm:text-2xl font-semibold text-center">Pick a voice</h1>
        {profile !== DEFAULT_PROFILE && (
          <p className="text-xs text-white/40 uppercase tracking-wider">
            profile: {profile} · audiopick: {audiopick}
          </p>
        )}

        {loading && <p className="text-white/50">Loading…</p>}
        {error && (
          <div className="w-full rounded-lg border border-red-400/40 bg-red-500/10 text-red-200 text-sm p-3">
            {error}
          </div>
        )}

        {/* Record new voice */}
        <section className="w-full rounded-2xl border border-white/15 bg-white/5 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">🎤 Record or upload a voice</h2>
            <span className="text-xs text-white/50 font-mono">{nowLabel}</span>
          </div>
          <p className="text-xs text-white/60">
            Record 5-30 seconds of clean, single-speaker speech, or upload an
            MP3 / M4A / WAV file (max 8 MB). Recording auto-stops at 30 s.
            The sample is stored so the clone can be selected later.
          </p>
          {!recordedBlob && !recording && (
            <div className="flex flex-col gap-2">
              <button
                onClick={startRecording}
                className="w-full rounded-lg bg-red-500 hover:bg-red-400 text-white py-3 font-medium"
              >
                ● Start recording
              </button>
              <div className="flex items-center gap-3 text-xs text-white/40">
                <div className="flex-1 h-px bg-white/10" />
                or
                <div className="flex-1 h-px bg-white/10" />
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-lg border border-white/30 py-3 font-medium hover:bg-white/10"
              >
                ⬆ Upload MP3 / M4A
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg"
                className="hidden"
                onChange={onFilePick}
              />
            </div>
          )}
          {recording && (
            <div className="flex flex-col gap-2">
              <button
                onClick={stopRecording}
                className="w-full rounded-lg bg-white text-black py-3 font-medium animate-pulse"
              >
                ■ Stop ({(elapsedMs / 1000).toFixed(1)} s / {MAX_RECORD_MS / 1000} s)
              </button>
              {/* Countdown bar — fills toward the 30 s cap. */}
              <div className="w-full h-1.5 rounded bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-red-400 transition-[width] duration-100"
                  style={{ width: `${Math.min(100, (elapsedMs / MAX_RECORD_MS) * 100)}%` }}
                />
              </div>
            </div>
          )}
          {recordedBlob && recordedUrl && (
            <div className="flex flex-col gap-2">
              <audio src={recordedUrl} controls className="w-full" />
              <p className="text-xs text-white/60">Duration: {secs}s</p>
              <div className="flex gap-2">
                <button
                  onClick={resetRecording}
                  disabled={submitting}
                  className="flex-1 rounded-lg border border-white/30 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
                >
                  Re-record
                </button>
                <button
                  onClick={submitClone}
                  disabled={submitting}
                  className="flex-[2] rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black py-2 font-medium disabled:opacity-40"
                >
                  {submitting ? "Cloning…" : "Submit & Talk"}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Previous clones */}
        <section className="w-full flex flex-col gap-2">
          <h2 className="text-lg font-medium">Previous clones</h2>
          {gridEmpty && !loading && (
            <p className="text-sm text-white/50">
              None yet. Record above, or use a default voice below.
            </p>
          )}
          {voices.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {voices.map((v) => {
                const armed = armedDelete === v.id
                const deleting = deletingSlug === v.id
                return (
                  <div
                    key={v.id}
                    className="relative rounded-lg border border-white/15 bg-white/5 p-3 flex flex-col gap-2"
                  >
                    {/* Two-click delete button in the top-right corner. */}
                    <button
                      onClick={() => onDeleteClick(v.id)}
                      disabled={deleting}
                      title={armed ? "Confirm delete" : "Delete this clone"}
                      className={
                        "absolute -top-2 -right-2 w-7 h-7 rounded-full text-xs font-medium " +
                        "flex items-center justify-center shadow-md transition-colors " +
                        (armed
                          ? "bg-red-500 text-white hover:bg-red-400"
                          : "bg-white/15 text-white/70 hover:bg-white/25")
                      }
                    >
                      {deleting ? "…" : armed ? "✓" : "×"}
                    </button>
                    <p className="text-xs text-white/70 font-mono leading-tight">
                      {formatSlug(v.id)}
                    </p>
                    <audio
                      src={voiceSampleUrl(v)}
                      controls
                      className="w-full h-8"
                      preload="none"
                    />
                    <button
                      onClick={() => goTalk(v.voice_id)}
                      disabled={deleting}
                      className="rounded-md bg-white text-black py-1.5 text-sm font-medium hover:bg-white/80 disabled:opacity-40"
                    >
                      Use this voice
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Skip */}
        <section className="w-full">
          <button
            onClick={() => goTalk()}
            className="w-full rounded-lg border border-white/30 py-3 text-sm hover:bg-white/10"
          >
            Skip — use default male / female
          </button>
        </section>

        <button
          onClick={backToGallery}
          className="text-xs text-white/50 mt-2 underline"
        >
          ← Back to gallery
        </button>
      </main>
    </div>
  )
}

export default function VoicePickerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <VoicePickerInner />
    </Suspense>
  )
}
