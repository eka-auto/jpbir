import crypto from 'crypto';
import fs from 'fs';

const sa = JSON.parse(fs.readFileSync('C:\\Users\\abcom\\Go4Garage\\Eka Runner\\serviceAccountKey.json', 'utf8'));

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = b64url({alg:'RS256',typ:'JWT'}) + '.' + b64url({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(input), sa.private_key);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: input + '.' + sig.toString('base64url')
    })
  });
  return (await r.json()).access_token;
}

(async () => {
  const token = await getToken();
  for (const db of ['eka-agent', '(default)']) {
    console.log(`=== DB: ${db} ===`);
    // Check devices collection
    const url = `https://firestore.googleapis.com/v1/projects/intrepid-stage-495117-q1/databases/${db}/documents/devices`;
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const data = await res.json();
    for (const doc of data.documents || []) {
      const id = doc.name.split('/').pop();
      console.log(`  Device: ${id}`);
      const f = doc.fields || {};
      for (const [k, v] of Object.entries(f)) {
        const valStr = JSON.stringify(v);
        if (valStr.includes('91') || valStr.includes('phone') || valStr.includes('sim') || valStr.includes('number') || valStr.includes('carrier')) {
          console.log(`    ${k}: ${valStr.slice(0, 150)}`);
        }
      }
    }
  }
})();
