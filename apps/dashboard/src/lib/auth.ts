import { NextRequest } from 'next/server';

export interface AuthTokenPayload {
  userId: string;
  email: string;
  role: string;
}

/**
 * Extract the authenticated userId from the JWT cookie on an incoming request.
 *
 * The `ai-engine-token` cookie is set at login and contains a JWT with
 * `{ userId, email, role }`.  This helper verifies the token and returns
 * the payload, or `null` if the token is missing / invalid / expired.
 *
 * Usage in API routes:
 *   const auth = await getAuthFromRequest(request);
 *   const userId = auth?.userId;
 */
export async function getAuthFromRequest(
  request: NextRequest,
): Promise<AuthTokenPayload | null> {
  const token = request.cookies.get('ai-engine-token')?.value;
  if (!token) return null;

  try {
    const jwt = await import('jsonwebtoken');
    const secret = process.env.INSTANCE_SECRET ?? 'dev-secret';
    const payload = jwt.default.verify(token, secret) as AuthTokenPayload;
    if (!payload.userId) return null;
    return payload;
  } catch {
    return null;
  }
}
