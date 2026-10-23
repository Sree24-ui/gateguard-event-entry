/**
 * Promotes an account to administrator, or creates one.
 *
 *   npm run make-admin -w server -- someone@college.edu [password]
 *
 * Administrators cannot be created by signing up — this is the only door,
 * and it needs shell access to the server.
 */
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../db/connect.js';
import { User } from '../models/User.js';

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email) {
    console.error('Usage: npm run make-admin -w server -- <email> [password]');
    process.exit(1);
  }

  await connectDb();
  const normalised = email.trim().toLowerCase();
  let user = await User.findOne({ email: normalised });

  if (user) {
    user.role = 'admin';
    user.status = 'approved';
    if (password) user.passwordHash = await bcrypt.hash(password, 12);
    await user.save();
    console.log(`[make-admin] ${normalised} is now an administrator`);
  } else {
    if (!password) {
      console.error('[make-admin] that account does not exist, so a password is required');
      await disconnectDb();
      process.exit(1);
    }
    user = await User.create({
      name: normalised.split('@')[0],
      email: normalised,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'admin',
      status: 'approved'
    });
    console.log(`[make-admin] created administrator ${normalised}`);
  }

  await disconnectDb();
}

main().catch(async (err) => {
  console.error('[make-admin] failed:', err.message);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
