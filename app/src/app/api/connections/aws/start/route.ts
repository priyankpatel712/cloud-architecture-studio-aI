import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified } from '@/lib/session';
import { fail } from '@/lib/api';
import { Connection } from '@/lib/models/Connection';
import { encryptSecret } from '@/lib/crypto';
import { startDeviceAuthorization, SsoNotConfiguredError } from '@/lib/providers/aws/auth';

export const runtime = 'nodejs';

/**
 * POST /api/connections/aws/start — begin the IAM Identity Center device flow
 * (FR-011). The device handle (client + device code) is stored encrypted on the
 * pending connection; the browser only ever sees the user-facing verification
 * code and URL (Constitution III).
 */
export async function POST() {
  try {
    const session = await requireVerified();
    await connectDB();

    let device;
    try {
      device = await startDeviceAuthorization();
    } catch (e) {
      if (e instanceof SsoNotConfiguredError) {
        return NextResponse.json({ error: e.message }, { status: 503 });
      }
      throw e;
    }

    await Connection.updateOne(
      { ownerId: session.sub, provider: 'aws' },
      {
        $set: {
          status: 'pending',
          region: process.env.AWS_SSO_REGION || 'us-east-1',
          encryptedSession: encryptSecret(
            JSON.stringify({
              kind: 'device-auth',
              clientId: device.clientId,
              clientSecret: device.clientSecret,
              deviceCode: device.deviceCode,
              deviceExpiresAt: new Date(Date.now() + device.expiresIn * 1000).toISOString(),
            })
          ),
          accountId: null,
          alias: null,
          permissionSet: null,
          sessionExpiresAt: null,
        },
      },
      { upsert: true }
    );

    return NextResponse.json({
      userCode: device.userCode,
      verificationUri: device.verificationUri,
      verificationUriComplete: device.verificationUriComplete,
      interval: device.interval,
      expiresIn: device.expiresIn,
    });
  } catch (e) {
    return fail(e);
  }
}
