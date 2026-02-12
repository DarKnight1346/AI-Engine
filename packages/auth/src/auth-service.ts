import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getDb } from '@ai-engine/db';
import type { User } from '@ai-engine/shared';

export interface AuthTokenPayload {
  userId: string;
  email: string;
  role: string;
}

export class AuthService {
  constructor(private jwtSecret: string) {}

  async createUser(email: string, password: string, displayName: string, role = 'member'): Promise<User> {
    const db = getDb();
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.user.create({
      data: { email, passwordHash, displayName, role },
    });
    return this.mapUser(user);
  }

  async authenticate(email: string, password: string): Promise<{ user: User; token: string } | null> {
    const db = getDb();
    const user = await db.user.findUnique({ where: { email } });
    if (!user) return null;

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return null;

    const token = this.generateToken(user);
    return { user: this.mapUser(user), token };
  }

  generateToken(user: { id: string; email: string; role: string }): string {
    return jwt.sign(
      { userId: user.id, email: user.email, role: user.role } satisfies AuthTokenPayload,
      this.jwtSecret,
      { expiresIn: '7d' }
    );
  }

  verifyToken(token: string): AuthTokenPayload | null {
    try {
      return jwt.verify(token, this.jwtSecret) as AuthTokenPayload;
    } catch {
      return null;
    }
  }

  async getUserById(id: string): Promise<User | null> {
    const db = getDb();
    const user = await db.user.findUnique({ where: { id } });
    return user ? this.mapUser(user) : null;
  }

  async updateUser(id: string, updates: Partial<Pick<User, 'displayName' | 'avatarUrl' | 'role'>>): Promise<User> {
    const db = getDb();
    const user = await db.user.update({ where: { id }, data: updates });
    return this.mapUser(user);
  }

  private mapUser(dbUser: any): User {
    return {
      id: dbUser.id,
      email: dbUser.email,
      displayName: dbUser.displayName,
      avatarUrl: dbUser.avatarUrl,
      role: dbUser.role as User['role'],
      createdAt: dbUser.createdAt,
    };
  }
}
