import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filename = path.basename(process.argv[2] || '');
const backupPath = path.join(root, 'data', 'backups', filename);
const keyText = process.env.BACKUP_KEY || '';

if (!/^family-soft-\d{4}-\d{2}-\d{2}-\d+\.sqlite\.enc$/.test(filename)) {
  console.error('Укажите имя резервного файла family-soft-ГГГГ-ММ-ДД-время.sqlite.enc из data/backups.');
  process.exitCode = 1;
} else if (keyText.length < 32) {
  console.error('BACKUP_KEY отсутствует или короче 32 символов.');
  process.exitCode = 1;
} else if (!fs.existsSync(backupPath)) {
  console.error('Резервная копия не найдена в data/backups.');
  process.exitCode = 1;
} else {
  const packed = fs.readFileSync(backupPath);
  if (packed.length < 28) {
    console.error('Файл резервной копии повреждён.');
    process.exitCode = 1;
  } else {
    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(packed.length - 16);
    const ciphertext = packed.subarray(12, packed.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(keyText).digest(), iv);
    decipher.setAuthTag(tag);
    const destination = path.join(root, 'data', 'restored-family-soft.sqlite');
    let createdDestination = false;
    try {
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      fs.writeFileSync(destination, plaintext, { flag: 'wx' });
      createdDestination = true;
      const restored = new Database(destination);
      const integrity = restored.pragma('integrity_check', { simple: true });
      restored.close();
      if (integrity !== 'ok') throw new Error('SQLite integrity check failed.');
      console.log(`Копия восстановлена и проверена: ${destination}`);
      console.log('Остановите сервер и сохраните текущую базу перед заменой файла data/family-soft.sqlite.');
    } catch (error) {
      if (createdDestination && fs.existsSync(destination)) fs.unlinkSync(destination);
      console.error('Не удалось расшифровать или проверить базу:', error.message);
      process.exitCode = 1;
    }
  }
}
