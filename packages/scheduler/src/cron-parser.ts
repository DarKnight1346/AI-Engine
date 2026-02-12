import cronParser from 'cron-parser';

export class CronParser {
  static getNextRun(cronExpr: string, after: Date = new Date()): Date | null {
    try {
      const interval = cronParser.parseExpression(cronExpr, { currentDate: after });
      return interval.next().toDate();
    } catch {
      return null;
    }
  }

  static getNextRuns(cronExpr: string, count: number, after: Date = new Date()): Date[] {
    try {
      const interval = cronParser.parseExpression(cronExpr, { currentDate: after });
      const runs: Date[] = [];
      for (let i = 0; i < count; i++) {
        runs.push(interval.next().toDate());
      }
      return runs;
    } catch {
      return [];
    }
  }

  static isValid(cronExpr: string): boolean {
    try {
      cronParser.parseExpression(cronExpr);
      return true;
    } catch {
      return false;
    }
  }

  static describe(cronExpr: string): string {
    // Simple human-readable descriptions for common patterns
    const parts = cronExpr.split(' ');
    if (parts.length < 5) return cronExpr;

    const [min, hour, dom, mon, dow] = parts;

    if (min === '*' && hour === '*') return 'Every minute';
    if (min.startsWith('*/')) return `Every ${min.slice(2)} minutes`;
    if (hour === '*') return `At minute ${min} of every hour`;
    if (dom === '*' && mon === '*' && dow === '*') return `Daily at ${hour}:${min.padStart(2, '0')}`;
    if (dom === '*' && mon === '*' && dow === '1-5') return `Weekdays at ${hour}:${min.padStart(2, '0')}`;

    return cronExpr;
  }
}
