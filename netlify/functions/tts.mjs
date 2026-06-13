/**
 * FrenchGo TTS Proxy — Netlify Function
 * Calls Google Cloud Text-to-Speech Neural2 API securely server-side.
 * The API key never reaches the client.
 *
 * GET /.netlify/functions/tts?q=bonjour
 * Returns: { audio: "<base64 MP3>" }
 * Cache-Control: public, max-age=604800 (7 days CDN cache)
 */

export default async (req, context) => {
  // CORS headers — allow requests from our PWA
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const text = url.searchParams.get('q') || '';
  const slow  = url.searchParams.get('speed') === 'slow';

  // Basic validation
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
            name: 'fr-FR-Neural2-C',   // female, natural French
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
      console.error('Google TTS error:', ttsRes.status, errText);
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
        // Cache 7 days at Netlify CDN — same text always yields same audio
        'Cache-Control': 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400',
        'Vary': 'Accept-Encoding',
      },
    });
  } catch (err) {
    console.error('TTS function error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

export const config = {
  path: '/api/tts',
};
