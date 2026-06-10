"use client"

import Link from "next/link"

const AGORA_LOGO =
  "https://cdn.prod.website-files.com/660affa848e8af81bdd03909/66ab7f671fb90c022fb7f1dc_Agora%20Logo%20Crisp-p-500.png"

// Per-profile co-branding. Add more entries here to pin a partner logo
// alongside the Agora one for a specific profile (e.g. partner demo).
const PARTNER_LOGOS: Record<string, { src: string; alt: string }> = {
  EVENTTRU: {
    // Icon from trulience.com's nav bar.
    src: "https://www.trulience.com/react/trulience-2.png",
    alt: "Trulience",
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
          <img src={partner.src} alt={partner.alt} className="h-8 w-auto" />
        </>
      )}
    </header>
  )
}
