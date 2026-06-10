import { config } from './config.js';

// Provider-agnostic SMS sender. Ping's phone verification calls sendSms() with a
// fully-formed message; how it actually goes out depends on SMS_PROVIDER:
//
//   'log'    – no real delivery. The text is logged and the OTP route returns the
//              code in its response (so the flow is testable before paying for a
//              gateway). This is the default.
//   'twilio' – Twilio's REST API (Basic auth, application/x-www-form-urlencoded).
//   'http'   – any JSON HTTP gateway: POST {"to","text"} to SMS_HTTP_URL.
//
// Returns { ok, provider, error? }. Never throws — a failed send shouldn't take
// down a request; the caller decides how loud to be about it.
export async function sendSms(to, text) {
  const provider = config.smsProvider;
  try {
    switch (provider) {
      case 'twilio':
        return await sendTwilio(to, text);
      case 'http':
        return await sendHttp(to, text);
      case 'log':
      default:
        console.log(`[sms:log] → ${to}: ${text}`);
        return { ok: true, provider: 'log' };
    }
  } catch (err) {
    console.error(`[sms:${provider}] send failed:`, err?.message || err);
    return { ok: false, provider, error: err?.message || 'send failed' };
  }
}

async function sendTwilio(to, text) {
  if (!config.twilioSid || !config.twilioToken || !config.smsFrom) {
    return { ok: false, provider: 'twilio', error: 'Twilio not configured' };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/Messages.json`;
  const auth = Buffer.from(`${config.twilioSid}:${config.twilioToken}`).toString('base64');
  const form = new URLSearchParams({ To: to, From: config.smsFrom, Body: text });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, provider: 'twilio', error: `HTTP ${res.status} ${detail}`.trim() };
  }
  return { ok: true, provider: 'twilio' };
}

async function sendHttp(to, text) {
  if (!config.smsHttpUrl) {
    return { ok: false, provider: 'http', error: 'SMS_HTTP_URL not set' };
  }
  const headers = { 'Content-Type': 'application/json' };
  if (config.smsHttpAuth) headers.Authorization = config.smsHttpAuth;
  const res = await fetch(config.smsHttpUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ to, text, from: config.smsFrom }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, provider: 'http', error: `HTTP ${res.status} ${detail}`.trim() };
  }
  return { ok: true, provider: 'http' };
}

// True when delivery is only simulated, so callers can surface the code to the
// client for testing.
export const smsIsSimulated = () => config.smsProvider === 'log';
