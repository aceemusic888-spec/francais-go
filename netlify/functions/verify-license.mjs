// ═══════════════════════════════════════════════════════
// verify-license.mjs — Validation licence Gumroad unique
// Vérifie la clé via API Gumroad + lie à un UID Firebase
// ═══════════════════════════════════════════════════════
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore }                  from 'firebase-admin/firestore';

const PRODUCT_PERMALINK = 'klcdld'; // francaisgo sur Gumroad

function initFirebase() {
  if (getApps().length) return;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(sa) });
}

export default async function handler(req, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ valid: false, error: 'Method not allowed' }), { status: 405, headers });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ valid: false, error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { license_key, uid } = body;
  if (!license_key || !uid) {
    return new Response(JSON.stringify({ valid: false, error: 'Missing license_key or uid' }), { status: 400, headers });
  }

  const key = license_key.trim().toUpperCase();

  // 1. Vérifier la clé via l'API Gumroad
  let gumroadOk = false;
  try {
    const res = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        product_permalink: PRODUCT_PERMALINK,
        license_key: key,
        increment_uses_count: 'false',
      }),
    });
    const data = await res.json();
    gumroadOk = data.success === true;
    if (!gumroadOk) {
      return new Response(JSON.stringify({ valid: false, error: 'invalid_key' }), { status: 200, headers });
    }
  } catch (e) {
    return new Response(JSON.stringify({ valid: false, error: 'gumroad_unreachable' }), { status: 200, headers });
  }

  // 2. Vérifier dans Firestore si la clé est déjà liée à un autre UID
  try {
    initFirebase();
    const db  = getFirestore();
    const ref = db.collection('licenses').doc(key);
    const snap = await ref.get();

    if (snap.exists) {
      const data = snap.data();
      if (data.uid && data.uid !== uid) {
        // Clé déjà utilisée par quelqu'un d'autre → refus
        return new Response(JSON.stringify({ valid: false, error: 'already_used' }), { status: 200, headers });
      }
    } else {
      // Première activation : lier la clé à cet UID
      await ref.set({ uid, activatedAt: Date.now(), key });
    }

    // Marquer l'utilisateur comme premium dans Firestore
    await db.collection('users').doc(uid).set({ premium: true, licenseKey: key, unlockedAt: Date.now() }, { merge: true });

    return new Response(JSON.stringify({ valid: true }), { status: 200, headers });

  } catch (e) {
    console.error('[verify-license] Firestore error:', e);
    return new Response(JSON.stringify({ valid: false, error: 'server_error' }), { status: 500, headers });
  }
}

export const config = { path: '/api/verify-license' };
