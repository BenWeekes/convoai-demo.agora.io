import Link from "next/link"

const AGORA_LOGO =
  "https://cdn.prod.website-files.com/660affa848e8af81bdd03909/66ab7f671fb90c022fb7f1dc_Agora%20Logo%20Crisp-p-500.png"

export function PageHeader() {
  return (
    <header className="w-full border-b border-white/10 px-4 py-3 flex items-center justify-center">
      <Link href="/" className="flex items-center gap-3">
        {/* Using a plain <img> here so we don't need to wire Next.js remotePatterns for this CDN */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={AGORA_LOGO} alt="Agora" className="h-8 w-auto" />
      </Link>
    </header>
  )
}
