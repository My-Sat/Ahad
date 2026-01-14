// utilities/hubtel_sms.js
const axios = require('axios');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// NEW: normalize Ghana phone to MSISDN for Hubtel
function normalizeGhanaToMsisdn(phone) {
  let p = String(phone || '').trim().replace(/\s+/g, '');
  if (!p) return '';

  // remove leading +
  if (p.startsWith('+')) p = p.slice(1);

  // 0XXXXXXXXX (10 digits) -> 233XXXXXXXXX
  if (p.startsWith('0') && p.length === 10) {
    p = '233' + p.slice(1);
  }

  // if already starts with 233 leave as-is
  return p;
}

// Sends SMS using Hubtel endpoint you provided.
// Uses Basic Auth: clientId:clientSecret
exports.sendSms = async function sendSms({ to, content }) {
  const endpoint = requireEnv('HUBTEL_SMS_ENDPOINT');
  const clientId = requireEnv('HUBTEL_CLIENT_ID');
  const clientSecret = requireEnv('HUBTEL_CLIENT_SECRET');
  const senderId = requireEnv('HUBTEL_SENDER_ID');

  const msisdn = normalizeGhanaToMsisdn(to);
  if (!msisdn) throw new Error('Missing recipient phone');

  const payload = {
    from: senderId,
    to: msisdn,
    content
  };

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const resp = await axios.post(endpoint, payload, {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });

  return resp.data;
};
