import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.env');
if (existsSync(output)) {
  console.log('.env already exists. No changes made.');
  process.exit(0);
}
const adminPassword = randomBytes(18).toString('base64url');
const cookieSecret = randomBytes(48).toString('hex');
const data = [
  '# Edit APP_BASE_URL before printing QR codes or going live.',
  'APP_BASE_URL=http://localhost:3000',
  'PORT=3000',
  'NODE_ENV=development',
  'CAMPAIGN_SLUG=outdoor-2026',
  'ADMIN_USERNAME=admin',
  `ADMIN_PASSWORD=${adminPassword}`,
  `COOKIE_SECRET=${cookieSecret}`,
  'DB_PATH=./data/referrals.sqlite',
  ''
].join('\n');
writeFileSync(output, data, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
console.log('Created .env. Keep it private (never upload it to GitHub).');
console.log('Admin username: admin');
console.log(`Admin password: ${adminPassword}`);
console.log('Your local admin page: http://localhost:3000/admin');
