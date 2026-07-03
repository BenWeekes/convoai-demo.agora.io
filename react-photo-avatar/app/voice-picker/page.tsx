"use client"

import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { PageHeader } from "@/components/PageHeader"
import {
  avatarTalkUrl,
  DEFAULT_PROFILE,
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
            <h2 className="text-lg font-medium">🎤 Record new voice</h2>
            <span className="text-xs text-white/50 font-mono">{nowLabel}</span>
          </div>
          <p className="text-xs text-white/60">
            Speak naturally for 5-30 seconds — the clone quality is best on
            a clean, single-speaker sample. Recording auto-stops at 30 s.
            Your recording is stored so it can be selected later.
          </p>
          {!recordedBlob && !recording && (
            <button
              onClick={startRecording}
              className="w-full rounded-lg bg-red-500 hover:bg-red-400 text-white py-3 font-medium"
            >
              ● Start recording
            </button>
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
              {voices.map((v) => (
                <div
                  key={v.id}
                  className="rounded-lg border border-white/15 bg-white/5 p-3 flex flex-col gap-2"
                >
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
                    className="rounded-md bg-white text-black py-1.5 text-sm font-medium hover:bg-white/80"
                  >
                    Use this voice
                  </button>
                </div>
              ))}
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
