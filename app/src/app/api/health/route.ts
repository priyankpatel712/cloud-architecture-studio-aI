import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  const hasMongoUri = Boolean(process.env.MONGODB_URI);
  const hasAuthSecret = Boolean(process.env.AUTH_SECRET);
  const hasEncryptionKey = Boolean(process.env.ENCRYPTION_KEY);
  const llmProvider = process.env.LLM_PROVIDER ?? 'nvidia';

  let dbConnected = false;
  let dbName: string | null = null;
  let dbError: string | null = null;

  try {
    const conn = await connectDB();
    dbConnected = conn.connection.readyState === 1;
    dbName = conn.connection.name;
  } catch (e: any) {
    dbError = e?.message || String(e);
  }

  const isHealthy = dbConnected && hasAuthSecret;

  return NextResponse.json(
    {
      status: isHealthy ? 'ok' : 'degraded',
      dbConnected,
      dbName,
      dbError,
      env: {
        hasMongoUri,
        hasAuthSecret,
        hasEncryptionKey,
        llmProvider,
        nodeEnv: process.env.NODE_ENV,
      },
      timestamp: new Date().toISOString(),
    },
    { status: isHealthy ? 200 : 500 }
  );
}
