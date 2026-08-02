import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified } from '@/lib/session';
import { fail, parseBody } from '@/lib/api';
import { atlasConnectSchema } from '@/lib/schemas';
import { Connection } from '@/lib/models/Connection';
import { encryptSecret } from '@/lib/crypto';
import { verifyAtlasKey, AtlasAuthError } from '@/lib/providers/mongodb/auth';
import { toConnectionView } from '@/lib/connections';

export const runtime = 'nodejs';

/**
 * POST /api/connections/mongodb — connect an Atlas organization with a scoped
 * read API key (FR-013). The key is verified against the Atlas Administration
 * API before anything is stored, and stored only encrypted (Constitution III).
 */
export async function POST(req: Request) {
  try {
    const session = await requireVerified();
    const body = await parseBody(req, atlasConnectSchema);
    await connectDB();

    let org;
    try {
      org = await verifyAtlasKey(body.publicKey, body.privateKey);
    } catch (e) {
      if (e instanceof AtlasAuthError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }

    const connection = await Connection.findOneAndUpdate(
      { ownerId: session.sub, provider: 'mongodb' },
      {
        $set: {
          status: 'connected',
          orgId: org.orgId,
          orgName: org.orgName,
          projectsCount: org.projectsCount,
          encryptedApiKey: encryptSecret(
            JSON.stringify({ publicKey: body.publicKey, privateKey: body.privateKey })
          ),
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    return NextResponse.json({ connection: toConnectionView(connection!) });
  } catch (e) {
    return fail(e);
  }
}

// DELETE /api/connections/mongodb — drop the encrypted key material.
export async function DELETE() {
  try {
    const session = await requireVerified();
    await connectDB();
    await Connection.updateOne(
      { ownerId: session.sub, provider: 'mongodb' },
      {
        $set: {
          status: 'disconnected',
          encryptedApiKey: null,
          orgId: null,
          orgName: null,
          projectsCount: 0,
        },
      }
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
