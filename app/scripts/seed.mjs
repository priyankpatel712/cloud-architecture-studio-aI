// Seed a super admin. Run with: npm run seed
// Reads MONGODB_URI and SEED_SUPERADMIN_* from .env.local.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal .env.local loader (avoids adding dotenv as a dependency).
try {
  const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trimStart().startsWith('#')) process.env[m[1]] ??= m[2];
  }
} catch {
  /* no .env.local — rely on real env */
}

const URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/cloud_architecture_studio';
const email = (process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
const password = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe!2026';
const name = process.env.SEED_SUPERADMIN_NAME ?? 'Super Admin';

const userSchema = new mongoose.Schema(
  {
    name: String,
    email: { type: String, unique: true },
    passwordHash: String,
    role: { type: String, default: 'user' },
    status: { type: String, default: 'active' },
    organization: { type: String, default: '' },
    lastLoginAt: { type: Date, default: null },
    // Seeded accounts are pre-verified (FR-004 clarification).
    emailVerifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
const User = mongoose.models.User ?? mongoose.model('User', userSchema);

await mongoose.connect(URI);

const existing = await User.findOne({ email });
if (existing) {
  await User.updateOne(
    { email },
    { $set: { name, role: 'super_admin', status: 'active', emailVerifiedAt: existing.emailVerifiedAt ?? new Date() } }
  );
  console.log('• Super admin already exists (role/status reset):', email);
} else {
  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({ name, email, passwordHash, role: 'super_admin', status: 'active', emailVerifiedAt: new Date() });
  console.log('✓ Created super admin:', email);
  console.log('  password:', password, '(change it after first login)');
}

await mongoose.disconnect();
process.exit(0);
