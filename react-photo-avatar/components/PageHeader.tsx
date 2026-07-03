"use client"

import Link from "next/link"

const AGORA_LOGO =
  "https://cdn.prod.website-files.com/660affa848e8af81bdd03909/66ab7f671fb90c022fb7f1dc_Agora%20Logo%20Crisp-p-500.png"

// Prefix for locally-served assets under the app's basePath. Empty in
// dev, "/photo" in prod. Matches the same env used by next.config.ts.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || ""

// Per-profile co-branding. Add more entries here to pin a partner logo
// alongside the Agora one for a specific profile (e.g. partner demo).
// `heightClass` overrides the default h-8 (2rem) so edge-to-edge SVGs
// don't visually tower over PNGs that carry baked-in whitespace padding.
type PartnerLogo = { src: string; alt: string; heightClass?: string }
const PARTNER_LOGOS: Record<string, PartnerLogo> = {
  EVENTTRU: {
    // Icon from trulience.com's nav bar.
    src: "https://www.trulience.com/react/trulience-2.png",
    alt: "Trulience",
  },
  GRADIUMDEMO: {
    // Local copy of https://mintcdn.com/gradium/.../logo/dark.svg — the
    // Mintlify CDN URL is signed and could rotate, so we self-host to
    // keep the demo stable.
    src: `${BASE}/partner/gradium.svg`,
    alt: "Gradium",
    // The Gradium SVG is a tight-cropped wordmark with no padding.
    // Agora PNG has ~15 % vertical padding baked in. Give Gradium a
    // slightly smaller box so the caps read as the same height.
    heightClass: "h-6",
  },
}

export function PageHeader({ profile }: { profile?: string }) {
  const partner = profile ? PARTNER_LOGOS[profile] : undefined
  return (
    <header className="w-full border-b border-white/10 px-4 py-3 flex items-center justify-center gap-6">
      <Link href="/" className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={AGORA_LOGO} alt="Agora" className="h-8 w-auto" />
      </Link>
      {partner && (
        <>
          <span className="text-white/30">×</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={partner.src}
            alt={partner.alt}
            className={`${partner.heightClass || "h-8"} w-auto`}
          />
        </>
      )}
    </header>
  )
}
