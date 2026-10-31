// Membuat nilai ADMIN_PASSWORD_HASH untuk file .env.
//   npm run admin:hash            (interaktif, input disembunyikan)
//   ADMIN_PASSWORD='...' npm run admin:hash   (non-interaktif)
import readline from 'node:readline';
import { hashPassword } from '../auth.js';

function promptHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = text => { if (text.includes(question)) rl.output.write(text); else if (text.includes('\n') || text.includes('\r')) rl.output.write('\n'); };
    rl.question(question, answer => { rl.close(); resolve(answer); });
  });
}

let password = process.env.ADMIN_PASSWORD;
if (!password) {
  password = await promptHidden('Password admin baru (min. 12 karakter): ');
  const again = await promptHidden('Ulangi password: ');
  if (password !== again) { console.error('Password tidak sama.'); process.exit(1); }
}
if (password.length < 12) { console.error('Password terlalu pendek (minimal 12 karakter).'); process.exit(1); }

console.log('\nSalin baris berikut ke file .env (atau environment variable hosting Anda):\n');
console.log(`ADMIN_PASSWORD_HASH=${await hashPassword(password)}\n`);
