# CloudSlot demo page — hosting options (for the TMS)

The CloudSlot operator page is a **single self-contained HTML file** that talks to the demo-backend
at `convoai-demo.agora.io`. There are two ways for the TMS to use it. Last updated 2026-10-16.

## Option A — just point at ours (easiest, nothing to copy)

Link to or `<iframe>` the live page:

```
https://convoai-demo.agora.io/cloudslot/
```

It's always current, needs no files on your side, and there's nothing to keep in sync. If you only
need to *show* the demo, use this.

## Option B — self-host the single HTML on your server (copy-and-serve)

The page already points at the backend with a **full absolute URL**
(`const BACKEND="https://convoai-demo.agora.io/simple-backend"`) and the backend already returns
permissive **CORS** headers (it echoes your `Origin`). So there is nothing to edit:

1. Copy **`cloudslot/index.html`** to your server and serve it. That's the whole page.
2. `AgoraRTC_N-4.23.0.js` loads from `https://download.agora.io`; there are **no other local files,
   images, or secrets** in the page. All session creds come from the backend at runtime
   (`/director/start`).

That's it — it works from any origin as-is. (If you later lock the backend's CORS to an allowlist,
send us the exact origin you serve it from and we'll add it.)

## What the page does (either way)

- `POST /director/start?profile=CLOUDSLOT&game=<url>&avatar=<id>` → gets dual-channel join creds +
  `eventsUrl`.
- Subscribes the **composite video** on the output channel (uid 102), publishes **mic** (muted by
  default) on the input channel, POSTs `clientVideoReady` on the first decoded frame.
- `POST /director/stop` on end.

So: **Option A** if you just want to display it; **Option B** (one-line change + tell us your origin
for CORS) if you want it served from your own domain.
