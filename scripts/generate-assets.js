import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imageDir = path.join(root, 'public', 'img');
const logo = path.join(imageDir, 'logo.jpg');

await Promise.all([
  sharp(logo).resize(32, 32, { fit: 'contain', background: '#FBF6EE' }).png().toFile(path.join(imageDir, 'favicon-32.png')),
  sharp(logo).resize(180, 180, { fit: 'contain', background: '#FBF6EE' }).png().toFile(path.join(imageDir, 'apple-touch-icon.png')),
  sharp(logo).resize(192, 192, { fit: 'contain', background: '#FBF6EE' }).png().toFile(path.join(imageDir, 'icon-192.png')),
  sharp(logo).resize(512, 512, { fit: 'contain', background: '#FBF6EE' }).png().toFile(path.join(imageDir, 'icon-512.png')),
  sharp(path.join(imageDir, 'hero-day.jpg')).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(imageDir, 'hero-day.webp')),
  sharp(path.join(imageDir, 'hero-night.jpg')).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(imageDir, 'hero-night.webp'))
]);
console.log('Generated Family Soft app icons and compressed hero images.');
