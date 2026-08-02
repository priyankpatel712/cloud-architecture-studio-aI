import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified } from '@/lib/session';
import { fail } from '@/lib/api';
import { Connection } from '@/lib/models/Connection';

export const runtime = 'nodejs';

/**
 * POST /api/connections/aws/disconnect — drop the temporary session material
 * immediately (FR-012). Nothing long-term exists to revoke.
 */
export async function POST() {
  try {
    const session = await requireVerified();
    await connectDB();
    await Connection.updateOne(
      { ownerId: session.sub, provider: 'aws' },
      {
        $set: {
          status: 'disconnected',
          encryptedSession: null,
          accountId: null,
          alias: null,
          permissionSet: null,
          sessionExpiresAt: null,
        },
      }
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
