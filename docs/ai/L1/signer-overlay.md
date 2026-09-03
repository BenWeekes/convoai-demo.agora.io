# Signer overlay demo (deep dive)

A chroma-keyed Signapse ASL signer overlaid transparently on a video, signing what's heard.
URL: `/sign-client?overlay=1`.

**Authoritative kit (self-contained, with scripts + idle asset):**
`sign-video-client/signer-overlay/README.md` in the `github.com/BenWeekes/sign-video-client` repo.
Read that for everything; summary below.

## The essentials
- **Signapse fix:** on `POST /v2/generate`, `config` MUST nest inside `output.delivery` or
  `digitalSigner`/`language`/`backgroundColor` are silently ignored.
- **Transparency = chroma-key**, not alpha codecs: Signapse only emits ProRes alpha (`.mov`, not
  browser-playable) and no WebM; HLS `stream` is CloudFront-403. So request a solid key colour
  (`backgroundColor:"#00FF00"`) → universal H.264 → key green in the browser (WebGL) → works
  Chrome + Safari. Signing clips are proxied same-origin (`/api/clip`) because WebGL can't texture
  cross-origin S3 video.
- **Idle** silence is on studio grey (#808BB7 ≈ clothing) so keying it eats the shirt; instead the
  idle is the silence **alpha cutout composited onto green** (`scripts/make-idle.sh` →
  `public/signer-overlay/idle-*.mp4`), keyed green like the signing clips.
- **Tuning** (URL `&sim=&smo=&spill=` or `lib/chroma.ts`): similarity/smoothness remove the green
  rim; eye-whites/skin are safe (far from green).

## Files (in `sign-video-client`)
`lib/chroma.ts`, `components/{KeyedVideo,SignPanel,VideoAvatarClient}.tsx`,
`app/api/{sign,clip}/route.ts`, `public/signer-overlay/idle-jay-asl-green.mp4`,
`signer-overlay/{README.md,scripts/}`.

## Football-game task
See `signer-overlay/README.md` §7: `…/sign-client?overlay=1&yt=<FOOTBALL_YOUTUBE_ID>`; the signer
signs the mic (a presenter speaking commentary) out of the box, with documented options to sign the
match's own audio (captions track or audio→STT).
