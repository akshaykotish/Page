import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let serviceAccount;
try {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || path.join(__dirname, 'akshaykotish-aca69-firebase-adminsdk-yi1ji-f1a589ef5a.json');
  serviceAccount = JSON.parse(readFileSync(credPath, 'utf8'));
} catch (e) {
  console.warn('Firebase Admin SDK credentials not found. Using default credentials.');
  serviceAccount = null;
}

if (!admin.apps.length) {
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: 'akshaykotish-aca69'
    });
  } else {
    admin.initializeApp({
      projectId: 'akshaykotish-aca69'
    });
  }
}

export const db = admin.firestore();
export const auth = admin.auth();
export default admin;
