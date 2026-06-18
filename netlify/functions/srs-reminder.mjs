// netlify/functions/srs-reminder.mjs
// Sends personalized SRS notifications with specific due words
export default async function handler(req, context) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY;
  if (!FCM_SERVER_KEY) return new Response('Missing FCM_SERVER_KEY', { status: 500 });

  let body;
  try { body = await req.json(); } catch(e) { return new Response('Invalid JSON', { status: 400 }); }

  const { token, words, lang } = body;
  if (!token || !Array.isArray(words) || !words.length) return new Response('Missing token or words', { status: 400 });

  const wordList = words.slice(0, 3).join(', ');
  const messages = {
    fr: { title: '🔁 Révision SRS', body: `Des mots t'attendent : ${wordList}` },
    en: { title: '🔁 SRS Review', body: `Words due for review: ${wordList}` },
    zh: { title: '🔁 SRS 复习', body: `待复习词汇：${wordList}` }
  };
  const msg = messages[lang] || messages.fr;

  const payload = {
    to: token,
    notification: {
      title: msg.title,
      body: msg.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      tag: 'srs-reminder'
    },
    data: { type: 'srs', words: wordList }
  };

  const res = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      'Authorization': 'key=' + FCM_SERVER_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const result = await res.json();
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
