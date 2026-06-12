/**
 * FrenchGo — Daily Reminder (Netlify Scheduled Function)
 * Runs every day at 09:00 UTC
 * Sends FCM push notifications to users inactive for 20+ hours
 *
 * Required Netlify env vars:
 *   FIREBASE_SERVICE_ACCOUNT  — JSON string of the Firebase service account key
 *                               (Firebase Console → Project Settings → Service Accounts → Generate new private key)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

export default async function handler() {
  // Init Firebase Admin (idempotent)
  if (!getApps().length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    initializeApp({ credential: cert(sa) });
  }

  const db  = getFirestore();
  const msg = getMessaging();

  const cutoff = Date.now() - 20 * 60 * 60 * 1000; // 20h ago

  const snap = await db.collection('users')
    .where('fcmToken', '!=', null)
    .where('lastActive', '<', cutoff)
    .limit(500)
    .get();

  if (snap.empty) {
    console.log('No inactive users to notify.');
    return { statusCode: 200, body: 'No users to notify' };
  }

  const messages = snap.docs
    .map(doc => doc.data().fcmToken)
    .filter(Boolean)
    .map(token => ({
      token,
      notification: {
        title: 'FrenchGo 🦊',
        body: "C'est l'heure de pratiquer le français !"
      },
      android: {
        notification: { icon: 'ic_launcher', color: '#4F46E5', channelId: 'daily_reminder' }
      },
      webpush: {
        notification: { icon: '/icon-192.png', badge: '/icon-192.png', tag: 'frenchgo-daily', renotify: true }
      }
    }));

  // FCM sendEach supports up to 500 messages per call
  const result = await msg.sendEach(messages);
  console.log(`Sent: ${result.successCount} | Failed: ${result.failureCount}`);

  return {
    statusCode: 200,
    body: JSON.stringify({ sent: result.successCount, failed: result.failureCount })
  };
}
