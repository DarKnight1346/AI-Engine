import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { email, password, displayName } = await req.json();

    if (!email || !password || !displayName) {
      return NextResponse.json({ error: 'All fields required' }, { status: 400 });
    }

    // TODO: Integrate with AuthService once DB is connected
    return NextResponse.json({
      user: { id: 'admin', email, displayName, role: 'admin' },
      token: 'placeholder-jwt-token',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
