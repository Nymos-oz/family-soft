import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, setting, setSetting } from '../src/database.js';
import { runLongPollingBot } from '../src/max-bot.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const controller = new AbortController();
let token = process.env.MAX_BOT_TOKEN || '';

function saveTokenToEnv(value) {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const tokenLine = `MAX_BOT_TOKEN=${JSON.stringify(value)}`;
  const tokenVariable = /^(?:export\s+)?MAX_BOT_TOKEN=.*$/m;
  const contents = tokenVariable.test(existing)
    ? existing.replace(tokenVariable, tokenLine)
    : `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${tokenLine}\n`;

  fs.writeFileSync(envPath, contents, { encoding: 'utf8', mode: 0o600 });
}

async function verifyToken(value) {
  let response;
  try {
    response = await fetch('https://platform-api2.max.ru/me', {
      headers: { Authorization: value },
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    throw new Error(`Could not connect to MAX API. Check internet access and try again. (${error.cause?.code || error.name})`);
  }
  if (!response.ok) throw new Error(`MAX did not accept the token (HTTP ${response.status}).`);
  const bot = await response.json();
  console.info(`Token verified for bot ${bot.username ? `@${bot.username}` : ''}.`);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => controller.abort());
}

try {
  if (process.argv.length > 2) {
    throw new Error('Do not add the bot token to the command. Run only: npm.cmd run bot:max:setup');
  }
  if (!token || /[\r\n]/.test(token)) throw new Error('The hidden PowerShell prompt did not provide a valid token.');
  await verifyToken(token);
  saveTokenToEnv(token);
  console.info('Token saved locally in the ignored .env file.');
  await runLongPollingBot({
    token,
    db,
    setting,
    setSetting,
    sbpPhone: process.env.SBP_PHONE || '',
    sbpBank: process.env.SBP_BANK || '',
    sbpReceiverName: process.env.SBP_RECEIVER_NAME || '',
    ownerUserId: process.env.MAX_BOT_OWNER_ID || '',
    signal: controller.signal
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  token = '';
  db.close();
}
