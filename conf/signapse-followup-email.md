# Signapse follow-up email (draft)

**Subject:** SignStream /v2/generate — config fix confirmed; follow-ups on HLS stream auth + browser-playable transparency

Hi [name],

Thank you — nesting the `config` block inside `output.delivery` was exactly it. Confirmed on `/v2/generate`:

- **ASL signer selection now works.** `digitalSigner:"JAY", language:"ASL"` now returns a genuinely different signer from `RAE`/`BSL` (previously every signer returned a byte-identical file).
- **Transparency now works.** `backgroundColor:"transparent"` now produces a real alpha channel (ProRes `yuva444p12le`).

Two things are still blocking us, both on `/v2/generate`:

## 1. HLS streaming — how do we authenticate the manifests?

This is the transport we want. `format:"hls"` + `delivery.method:"stream"` responds instantly with manifest URLs:

```
{"jobId":"…","status":"PROGRESSING","manifests":{
  "hls":"https://live.api.production.signapsesolutions.com/media/<id>/index.m3u8",
  "dash":"https://live.api.production.signapsesolutions.com/media/<id>/manifest.mpd"}}
```

But a GET on either manifest returns **403**:

```
<Error><Code>MissingKey</Code><Message>Missing Key-Pair-Id query parameter or cookie value</Message></Error>
```

The generate response contains **no** signed query parameters and **no** `Set-Cookie`, and the `X-API-KEY` header is not accepted on the `live.api…` CDN host. How are we meant to authenticate the stream — CloudFront **signed cookies**, a **signed manifest URL**, or a **token** returned in the response / passed in `delivery.config`?

Request used:
```
curl -X POST "https://ai.api.production.signapsesolutions.com/v2/generate" \
  -H "X-API-KEY: <key>" -H "Content-Type: application/json" \
  -d '{"content":{"type":"text","data":"hls"},"output":{"format":"hls","delivery":{"method":"stream","config":{"digitalSigner":"JAY","language":"ASL","backgroundColor":"transparent","codec":"h265"}}},"context":{"application":"media"}}'
```

## 2. Browser-playable transparency (WebM VP9/AV1 alpha, or HEVC-alpha over HLS?)

The alpha output only comes back as **ProRes 4444 in a `.mov`** (via `delivery.method:"download"`), which browsers can't play in a `<video>` element. On `mov`/`download`, the `codec` field (`vp9`/`av1`/`h265`) appears to be **ignored** — the output is always ProRes.

Can `/v2/generate` produce a browser-playable alpha format — **VP9-alpha or AV1-alpha in WebM** (for Chrome/Firefox), or **HEVC-alpha over the HLS stream** (for Safari)? We can transcode ProRes → WebM ourselves as a stopgap, but a native alpha stream would be much better for live use.

Request used:
```
curl -X POST "https://ai.api.production.signapsesolutions.com/v2/generate" \
  -H "X-API-KEY: <key>" -H "Content-Type: application/json" \
  -d '{"content":{"type":"text","data":"transparent"},"output":{"format":"mov","delivery":{"method":"download","config":{"digitalSigner":"RAE","language":"BSL","backgroundColor":"transparent","codec":"vp9"}}},"context":{"application":"media"}}'
```

## Minor

On `delivery.method:"download"`, requesting `codec:"vp9"` (and `av1`) returns **408** `{"code":"TRANSLATION_TIMEOUT","message":"translation did not complete in time"}` — presumably the synchronous download path can't wait for the slower encode. The `stream` path returns immediately, so this is only an issue for `download`.

Thanks again for the quick turnaround on the config fix.

Best,
[you]
