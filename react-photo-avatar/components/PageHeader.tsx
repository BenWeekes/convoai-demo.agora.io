"use client"

import Link from "next/link"

const AGORA_LOGO =
  "https://cdn.prod.website-files.com/660affa848e8af81bdd03909/66ab7f671fb90c022fb7f1dc_Agora%20Logo%20Crisp-p-500.png"

// Prefix for locally-served assets under the app's basePath. Empty in
// dev, "/photo" in prod. Matches the same env used by next.config.ts.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || ""

// Per-profile co-branding. Add more entries here to pin a partner logo
// alongside the Agora one for a specific profile (e.g. partner demo).
type PartnerLogo = { src: string; alt: string }
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
  },
}

// Both logos are boxed to the same fixed height in their own containers
// with object-contain, so images with different bundled padding (Agora
// PNG has whitespace baked in; Gradium SVG is edge-to-edge) render at
// the same visible cap height without needing per-partner overrides.
const LOGO_BOX = "h-8 w-auto flex items-center"

export function PageHeader({ profile }: { profile?: string }) {
  const partner = profile ? PARTNER_LOGOS[profile] : undefined
  return (
    <header className="w-full border-b border-white/10 px-4 py-3 flex items-center justify-center gap-6">
      <Link href="/" className={LOGO_BOX}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={AGORA_LOGO} alt="Agora" className="h-full w-auto object-contain" />
      </Link>
      {partner && (
        <div className={LOGO_BOX}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={partner.src}
            alt={partner.alt}
            className="h-full w-auto object-contain"
          />
        </div>
      )}
    </header>
  )
}
