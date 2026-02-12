import { getDb } from '@ai-engine/db';
import { generateId } from '@ai-engine/shared';
import type { Team, TeamMember, TeamInvite } from '@ai-engine/shared';

export class TeamService {
  async createTeam(name: string, ownerUserId: string, description?: string): Promise<Team> {
    const db = getDb();
    const team = await db.team.create({
      data: { name, description },
    });
    await db.teamMember.create({
      data: { teamId: team.id, userId: ownerUserId, teamRole: 'owner' },
    });
    return this.mapTeam(team);
  }

  async getTeam(teamId: string): Promise<Team | null> {
    const db = getDb();
    const team = await db.team.findUnique({ where: { id: teamId } });
    return team ? this.mapTeam(team) : null;
  }

  async getUserTeams(userId: string): Promise<Team[]> {
    const db = getDb();
    const memberships = await db.teamMember.findMany({
      where: { userId },
      include: { team: true },
    });
    return memberships.map((m) => this.mapTeam(m.team));
  }

  async getTeamMembers(teamId: string): Promise<TeamMember[]> {
    const db = getDb();
    const members = await db.teamMember.findMany({ where: { teamId } });
    return members.map((m) => ({
      id: m.id,
      teamId: m.teamId,
      userId: m.userId,
      teamRole: m.teamRole as TeamMember['teamRole'],
      joinedAt: m.joinedAt,
    }));
  }

  async createInvite(teamId: string, email: string, invitedByUserId: string): Promise<TeamInvite> {
    const db = getDb();
    const token = generateId();
    const invite = await db.teamInvite.create({
      data: {
        teamId,
        email,
        token,
        invitedByUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return {
      id: invite.id,
      teamId: invite.teamId,
      email: invite.email,
      token: invite.token,
      invitedByUserId: invite.invitedByUserId,
      expiresAt: invite.expiresAt,
      acceptedAt: invite.acceptedAt,
    };
  }

  async acceptInvite(token: string, userId: string): Promise<TeamMember | null> {
    const db = getDb();
    const invite = await db.teamInvite.findUnique({ where: { token } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return null;

    await db.teamInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    const member = await db.teamMember.create({
      data: { teamId: invite.teamId, userId, teamRole: 'member' },
    });
    return {
      id: member.id,
      teamId: member.teamId,
      userId: member.userId,
      teamRole: member.teamRole as TeamMember['teamRole'],
      joinedAt: member.joinedAt,
    };
  }

  async updateTeamSettings(teamId: string, updates: Partial<Pick<Team, 'name' | 'description' | 'aiSensitivity' | 'alwaysRespondKeywords' | 'quietHours'>>): Promise<Team> {
    const db = getDb();
    const team = await db.team.update({
      where: { id: teamId },
      data: {
        name: updates.name,
        description: updates.description,
        aiSensitivity: updates.aiSensitivity,
        alwaysRespondKeywords: updates.alwaysRespondKeywords ? JSON.parse(JSON.stringify(updates.alwaysRespondKeywords)) : undefined,
        quietHours: updates.quietHours ? JSON.parse(JSON.stringify(updates.quietHours)) : undefined,
      },
    });
    return this.mapTeam(team);
  }

  private mapTeam(dbTeam: any): Team {
    return {
      id: dbTeam.id,
      name: dbTeam.name,
      description: dbTeam.description,
      aiSensitivity: dbTeam.aiSensitivity,
      alwaysRespondKeywords: dbTeam.alwaysRespondKeywords as string[],
      quietHours: dbTeam.quietHours as Team['quietHours'],
      createdAt: dbTeam.createdAt,
    };
  }
}
