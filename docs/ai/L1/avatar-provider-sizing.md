# Avatar provider sizing & aspect-ratio capabilities

Reference for the generic avatar providers we drive over the **`convoai_to_video`**
protocol (github.com/AgoraIO-Solutions/convoai_to_video): how to switch
portrait / landscape / square per provider, and the exact dimensions each mode
publishes. Measured directly off the Agora channel (see `avatar-direct/`), last
verified **2026-09**.

## TL;DR

- **The Agora RTC channel does not control size.** It transports whatever pixels the
  vendor's renderer produces. The only levers are per-vendor session params.
- **The protocol standardizes no size control.** `session/start` defines only
  `avatar_id`, `quality` (`low`/`medium`/`high`), `version`, `video_encoding`,
  `activity_idle_timeout`, `area`, `agora_settings`. There is **no `aspect_ratio` and
  no `width`/`height`** in the spec. `quality` changes bitrate/fidelity **only** — not
  resolution or aspect (verified: identical dims at `low` vs `high`).
- Each vendor bolted on its own knob (or none):
  - **LemonSlice** — non-standard `aspect_ratio` top-level field (honored).
  - **Anam** — `width`/`height` inside its two-step `agoraSettings` (honored, but the
    model only allows a fixed set of pairs).
  - **Tavus / Protoface** — **no** size control; aspect is baked into the avatar/plan.

## Capability matrix

| Provider | Orientation control | Modes → exact published dims | Max long edge | Can match Anam's 2:3 / 3:2? |
|---|---|---|---|---|
| **Anam** | `width`/`height` in `agoraSettings` (two-step API) | `cara-4`: **1152×768** (landscape 3:2), **768×1152** (portrait 2:3). Nothing else. | 1152 | — (is the reference) |
| **LemonSlice** | `aspect_ratio` (non-standard extension) | `1x1`→432×432 · `16x9`→608×336 · `9x16`→336×608 · `2x3`→368×560 · `3x2`→560×368 | 608 | **Yes** — `2x3` / `3x2` |
| **Tavus** | none — fixed by the avatar/replica | `r82c08901584`→**720×720** always · older persona `p…`→1280×720 | ~1280 (avatar-dependent) | **No** — locked square |
| **Protoface** | none — fixed | `av_stock_001`→**512×512** always | 512 | **No** — locked square |

### How to switch modes

- **Anam** — set `width`/`height` in `environment.agoraSettings` to one of the model's
  supported pairs. Wrong values return HTTP 400 with the allowed set, e.g.
  `{"error":"video_dimensions_not_supported_for_model","supportedDimensions":["1152x768","768x1152"]}`.
  The pairs are **per model** and **per avatar** (avatar `a4756a2a` supports only
  `cara-4`/`cara-4-latest`). No square option exists for cara-4.
- **LemonSlice** — set top-level `aspect_ratio`. Valid: `1x1`, `16x9`, `9x16`, `2x3`,
  `3x2`. Invalid (400 `Invalid aspect_ratio.`): `4x5`, `3x4`, `4x3`, `5x6`, `1x2`.
  Output is **low-res** (~600px long edge) regardless of `quality`. `avatar_id` is an
  **image URL**, so you can also swap the *face* per session.
- **Tavus** — orientation is a property of the replica/persona; the `aspect_ratio` field
  is ignored. To change aspect, use a differently-rendered avatar. Tavus normalizes some
  avatars to square (720²) irrespective of the source image's framing.
- **Protoface** — no knob; renders a fixed 512×512 (watermarked on the free tier).

## Consequences for a side-by-side grid

- **No aspect is shared by all four.** Best common denominator is **1:1** (Tavus,
  LemonSlice, Protoface do it; **Anam cannot** — its floor is 3:2). Portrait/landscape
  parity is possible for **Anam + LemonSlice only**.
- **Same source face across providers** only transfers to LemonSlice (image-URL avatar).
  Tavus/Protoface use pre-trained replica IDs, not per-session images; matching their
  likeness means creating new replicas offline, and even then their output aspect stays
  locked.

## Protocol gaps to raise with `convoai_to_video` maintainers

1. Standardize an orientation/size request — either `aspect_ratio` **or** `width`/
   `height` — as an optional top-level field all vendors SHOULD honor where possible,
   and echo the granted dimensions back in the `session/start` response.
2. Vendor-specific asks: **Protoface** honor a size request (currently 512×512 only);
   **Tavus** honor `aspect_ratio` or expose per-render aspect; **Anam** add a square
   option for cara-4 (already added landscape/portrait on request).

See `avatar-direct/README.md` for the driver/recorder and the live grid at
`/avatar-overlay/avatar-grid.html`.
