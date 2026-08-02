import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified } from '@/lib/session';
import { fail } from '@/lib/api';
import { Connection } from '@/lib/models/Connection';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import {
  pollDeviceToken,
  describeSsoAccount,
  SsoPendingError,
  SsoExpiredError,
} from '@/lib/providers/aws/auth';
import { toConnectionView } from '@/lib/connections';

export const runtime = 'nodejs';

/**
 * POST /api/connections/aws/poll — exchange the pending device code once.
 * 202 while the user has not approved yet; 200 with the connection once approved
 * (only the encrypted TEMPORARY session is stored — FR-012); 410 when the device
 * code expired and the flow must be restarted.
 */
export async function POST() {
  try {
    const session = await requireVerified();
    await connectDB();
    const connection = await Connection.findOne({ ownerId: session.sub, provider: 'aws' }).select(
      '+encryptedSession'
    );
    if (!connection || connection.status !== 'pending' || !connection.encryptedSession) {
      return NextResponse.json({ error: 'No AWS connection attempt in progress.' }, { status: 404 });
    }

    const handle = JSON.parse(decryptSecret(connection.encryptedSession)) as {
      kind: string;
      clientId: string;
      clientSecret: string;
      deviceCode: string;
      deviceExpiresAt: string;
    };
    if (handle.kind !== 'device-auth' || new Date(handle.deviceExpiresAt) < new Date()) {
      connection.status = 'disconnected';
      connection.encryptedSession = null;
      await connection.save();
      return NextResponse.json(
        { error: 'The sign-in request expired. Start the connection again.' },
        { status: 410 }
      );
    }

    try {
      const token = await pollDeviceToken(handle);
      const account = await describeSsoAccount(token.accessToken);
      connection.status = 'connected';
      connection.accountId = account.accountId;
      connection.alias = account.alias;
      connection.permissionSet = account.permissionSet;
      connection.sessionExpiresAt = new Date(token.expiresAt);
      connection.encryptedSession = encryptSecret(
        JSON.stringify({ kind: 'sso-session', accessToken: token.accessToken, expiresAt: token.expiresAt })
      );
      await connection.save();
      return NextResponse.json({ connection: toConnectionView(connection) });
    } catch (e) {
      if (e instanceof SsoPendingError) {
        return NextResponse.json({ status: 'pending', slowDown: e.slowDown }, { status: 202 });
      }
      if (e instanceof SsoExpiredError) {
        connection.status = 'disconnected';
        connection.encryptedSession = null;
        await connection.save();
        return NextResponse.json({ error: e.message }, { status: 410 });
      }
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
}
