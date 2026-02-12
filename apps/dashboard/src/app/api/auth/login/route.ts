import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    // TODO: Integrate with AuthService once DB is connected
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    // Placeholder - return mock token
    return NextResponse.json({
      user: { id: 'admin', email, displayName: 'Admin', role: 'admin' },
      token: 'placeholder-jwt-token',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
