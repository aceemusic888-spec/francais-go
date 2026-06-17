/**
 * FrenchGo TTS Proxy — Netlify Function
 * Calls Google Cloud Text-to-Speech Neural2 API securely server-side.
 *
 * Security layers:
 *  1. Origin check — only our domains can call this endpoint
 *  2. IP rate limiting — 30 req/hour per IP (via Netlify Blobs)
 *  3. Global daily cap — 500 calls/day total (budget protection)
 */

import { getStore } from '@netlify/blobs';

// ── Config ─────────────────────────────────────────────────────────
const IP_LIMIT_PER_HOUR  = 30;   // per IP per hour
const GLOBAL_DAILY_LIMIT = 500;  // total across all users per day

const ALLOWED_ORIGINS = [
  'https://francais-go.netlify.app',
  'https://frenchgo.app',
  'https://www.frenchgo.app',
];

// ── Helpers ─────────────────────────────────────────────────────────
function isOriginAllowed(origin, referer) {
  if (!origin && !referer) return true; // TWA / direct — no Origin header
  const src = origin || referer || '';
  return ALLOWED_ORIGINS.some(o => src.startsWith(o));
}

function jsonResponse(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

// ── Main handler ─────────────────────────────────────────────────────
export default async (req, context) => {
  const origin  = req.headers.get('origin')  || '';
  const referer = req.headers.get('referer') || '';

  const corsHeaders = {
    'Access-Control-Allow-Origin':  isOriginAllowed(origin, referer) ? (origin || '*') : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ① Origin check
  if (!isOriginAllowed(origin, referer)) {
    console.warn('[TTS] Blocked origin:', origin || referer);
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ② + ③ Rate limiting via Netlify Blobs
  const ip  = context.ip
    || req.headers.get('x-nf-client-connection-ip')
    || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const now     = Date.now();
  const hourKey = `ip:${ip}:${Math.floor(now / 3_600_000)}`; // resets each hour
  const dayKey  = `global:${new Date().toISOString().slice(0, 10)}`; // YYYY-MM-DD

  try {
    const store = getStore('tts-rate-limits');

    const [ipRaw, globalRaw] = await Promise.all([
      store.get(hourKey, { type: 'json' }).catch(() => null),
      store.get(dayKey,  { type: 'json' }).catch(() => null),
    ]);

    const ipCount     = (ipRaw?.count     || 0) + 1;
    const globalCount = (globalRaw?.count || 0) + 1;

    if (ipCount > IP_LIMIT_PER_HOUR) {
      console.warn('[TTS] IP rate limit hit:', ip);
      return new Response(JSON.stringify({ error: 'Trop de requêtes. Réessaie dans une heure.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '3600' },
      });
    }

    if (globalCount > GLOBAL_DAILY_LIMIT) {
      console.warn('[TTS] Global daily cap reached:', globalCount);
      return new Response(JSON.stringify({ error: 'Quota journalier atteint. Réessaie demain.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '86400' },
      });
    }

    // Persist updated counters asynchronously (don't block the response)
    Promise.all([
      store.setJSON(hourKey, { count: ipCount },     { ttl: 7_200   }),  // 2h TTL
      store.setJSON(dayKey,  { count: globalCount }, { ttl: 172_800 }),  // 2d TTL
    ]).catch(e => console.warn('[TTS] Counter update failed:', e.message));

  } catch (e) {
    // Blob store unavailable — log and let the request through (graceful degradation)
    console.warn('[TTS] Rate limit store unavailable:', e.message);
  }

  // ── TTS request ──────────────────────────────────────────────────
  const url  = new URL(req.url);
  const text = url.searchParams.get('q') || '';
  const slow = url.searchParams.get('speed') === 'slow';

  if (!text || text.length > 500) {
    return new Response(JSON.stringify({ error: 'Invalid text' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = Netlify.env.get('GOOGLE_TTS_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'TTS not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const ttsRes = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: 'fr-FR',
            name: 'fr-FR-Neural2-C',
            ssmlGender: 'FEMALE',
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: slow ? 0.65 : 0.90,
            pitch: 0,
            volumeGainDb: 0,
          },
        }),
      }
    );

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error('[TTS] Google API error:', ttsRes.status, errText);
      return new Response(JSON.stringify({ error: 'TTS API error', status: ttsRes.status }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await ttsRes.json();

    return new Response(JSON.stringify({ audio: data.audioContent }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        // 7-day CDN cache — same text always yields same audio
        'Cache-Control': 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400',
        'Vary': 'Accept-Encoding',
      },
    });

  } catch (err) {
    console.error('[TTS] Internal error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

export const config = { path: '/api/tts' };
