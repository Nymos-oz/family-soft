import { db, setting, setSetting } from '../src/database.js';
import { runLongPollingBot } from '../src/max-bot.js';

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => controller.abort());
}

try {
  await runLongPollingBot({
    token: process.env.BUYER_BOT_TOKEN || process.env.MAX_BOT_TOKEN,
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
  db.close();
}
