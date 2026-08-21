// Server-side proxy to Signapse SignStream /v2/generate. Keeps the API key
// off the client. Input: { text, avatar? }. Output: { url } — a presigned
// MP4 URL (h264, video-only, ~5 s to generate, link valid ~5 min).
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const SIGNAPSE_HOST =
  process.env.SIGNAPSE_HOST || "https://ai.api.production.signapsesolutions.com";
const SIGNAPSE_URL = process.env.SIGNAPSE_URL || `${SIGNAPSE_HOST}/v2/generate`;

// One signer identity drives BOTH endpoints so the signing clip (/v2/generate)
// and the idle loop (/v1/silence) always show the SAME person. Signer names:
// RAE = BSL, JAY / MAX = ASL. The two endpoints use their own casing (generate
// wants upper-case in output.config.digitalSigner; silence wants lower-case in
// ?signer=), so we normalise here.
const SIGNER = (process.env.SIGNAPSE_AVATAR || "RAE").toUpperCase();
const LANGUAGE = (process.env.SIGNAPSE_LANGUAGE || (SIGNER === "RAE" ? "BSL" : "ASL")).toUpperCase();

// GET /api/sign?idle=1 -> a neutral-pose idle loop MP4 for the current signer,
// used to keep the avatar on screen between signed phrases.
export async function GET() {
  const key = process.env.SIGNAPSE_API_KEY;
  if (!key) return NextResponse.json({ error: "SIGNAPSE_API_KEY not set" }, { status: 500 });
  const signer = SIGNER.toLowerCase();
  const language = LANGUAGE.toLowerCase();
  try {
    const r = await fetch(
      `${SIGNAPSE_HOST}/v1/silence?format=mp4&language=${language}&signer=${signer}`,
      { headers: { "X-API-KEY": key } },
    );
    const j = (await r.json().catch(() => null)) as { data?: string[] } | null;
    const url = j?.data?.[0];
    if (url) return NextResponse.json({ url });
    return NextResponse.json({ error: `silence ${r.status}` }, { status: 502 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const key = process.env.SIGNAPSE_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "SIGNAPSE_API_KEY not set" }, { status: 500 });
  }
  let body: { text?: string; avatar?: string; turn?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const text = (body.text || "").trim();
  if (!text) return NextResponse.json({ error: "missing text" }, { status: 400 });
  const signer = (body.avatar || SIGNER).toUpperCase();
  const language = LANGUAGE;

  // Log the exact text handed to Signapse so we can verify, from the server side,
  // that each turn's full transcript arrives (concatenate the deltas to rebuild it).
  console.log(`[sign ${new Date().toISOString().slice(11, 23)}] POST turn=${body.turn ?? "?"} ${text.length}ch: ${JSON.stringify(text)}`);

  try {
    const r = await fetch(SIGNAPSE_URL, {
      method: "POST",
      redirect: "manual", // capture the 303 Location (presigned MP4 URL)
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { type: "text", data: text },
        // digitalSigner + language live under output.config (NOT output.avatar,
        // which is silently ignored and falls back to the default signer).
        output: {
          format: "mp4",
          delivery: { method: "download" },
          config: { digitalSigner: signer, language },
        },
        context: { application: "media" },
      }),
    });
    const loc = r.headers.get("location");
    if ((r.status === 303 || r.status === 302) && loc) {
      console.log(`[sign]  -> clip ok (${text.length}ch)`);
      return NextResponse.json({ url: loc });
    }
    const detail = await r.text().catch(() => "");
    console.log(`[sign]  -> FAILED signapse ${r.status}: ${detail.slice(0, 200)}`);
    return NextResponse.json(
      { error: `signapse ${r.status}`, detail: detail.slice(0, 300) },
      { status: 502 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: `signapse fetch failed: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}
