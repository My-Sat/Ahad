// utilities/hubtel_sms.js
const axios = require('axios');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Sends SMS using Hubtel endpoint you provided.
// Uses Basic Auth: clientId:clientSecret
exports.sendSms = async function sendSms({ to, content }) {
  const endpoint = requireEnv('HUBTEL_SMS_ENDPOINT');
  const clientId = requireEnv('HUBTEL_CLIENT_ID');
  const clientSecret = requireEnv('HUBTEL_CLIENT_SECRET');
  const senderId = requireEnv('HUBTEL_SENDER_ID');

  // Hubtel typically expects MSISDN format. If your stored phones are like 054xxxxxxx,
  // convert before calling (you can implement normalization in controller).
  const payload = {
    from: senderId,
    to,
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
