const token = process.env.MAX_BOT_TOKEN || '';
const webhookUrl = process.env.MAX_WEBHOOK_URL || '';
const secret = process.env.MAX_WEBHOOK_SECRET || '';

if (!token) throw new Error('MAX_BOT_TOKEN is required in the local .env file.');
if (!secret || secret.length < 32) throw new Error('MAX_WEBHOOK_SECRET must contain at least 32 characters.');
let endpoint;
try {
  endpoint = new URL(webhookUrl);
} catch {
  throw new Error('Set MAX_WEBHOOK_URL to the deployed HTTPS Worker URL ending in /webhook.');
}
if (endpoint.protocol !== 'https:' || !endpoint.pathname.endsWith('/webhook')) {
  throw new Error('MAX_WEBHOOK_URL must be an HTTPS endpoint ending in /webhook.');
}

const response = await fetch('https://platform-api2.max.ru/subscriptions', {
  method: 'POST',
  headers: {
    Authorization: token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    url: endpoint.href,
    update_types: ['message_created', 'bot_started'],
    secret
  }),
  signal: AbortSignal.timeout(15000)
});
if (!response.ok) {
  throw new Error(`MAX rejected the webhook subscription (HTTP ${response.status}). Check the Worker URL and existing subscriptions.`);
}
console.info('MAX webhook registered successfully.');
