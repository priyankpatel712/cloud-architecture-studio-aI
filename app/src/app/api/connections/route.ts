import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified } from '@/lib/session';
import { fail } from '@/lib/api';
import { Connection } from '@/lib/models/Connection';
import { toConnectionView } from '@/lib/connections';

export const runtime = 'nodejs';

// GET /api/connections — both providers' connection state for the current user.
export async function GET() {
  try {
    const session = await requireVerified();
    await connectDB();
    const connections = await Connection.find({ ownerId: session.sub });
    return NextResponse.json({
      connections: Object.fromEntries(connections.map((c) => [c.provider, toConnectionView(c)])),
    });
  } catch (e) {
    return fail(e);
  }
}
