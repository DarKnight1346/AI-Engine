import prompts from 'prompts';
import { randomBytes } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';

export async function createServer(): Promise<void> {
  console.log('\n🚀 AI Engine Server Setup\n');

  const answers = await prompts([
    {
      type: 'text',
      name: 'domain',
      message: 'Domain name (or localhost for dev):',
      initial: 'localhost',
    },
    {
      type: 'number',
      name: 'port',
      message: 'Dashboard port:',
      initial: 3000,
    },
    {
      type: 'select',
      name: 'dbMode',
      message: 'PostgreSQL setup:',
      choices: [
        { title: 'Auto (Docker Compose)', value: 'auto' },
        { title: 'Use existing connection string', value: 'manual' },
      ],
    },
    {
      type: (prev: string) => prev === 'manual' ? 'text' : null,
      name: 'databaseUrl',
      message: 'PostgreSQL connection string:',
    },
    {
      type: (prev: string, values: any) => values.dbMode === 'manual' ? 'text' : null,
      name: 'redisUrl',
      message: 'Redis connection string:',
      initial: 'redis://localhost:6379',
    },
  ]);

  if (!answers.domain) {
    console.log('Setup cancelled.');
    return;
  }

  const instanceSecret = randomBytes(32).toString('hex');
  const serverDir = process.cwd();

  // Generate .env
  const isAuto = answers.dbMode === 'auto';
  const dbUrl = isAuto ? 'postgresql://ai_engine:ai_engine_password@localhost:5432/ai_engine' : answers.databaseUrl;
  const redisUrl = isAuto ? 'redis://localhost:6379' : answers.redisUrl;

  const envContent = `# AI Engine Server Configuration
# Generated on ${new Date().toISOString()}

DATABASE_URL="${dbUrl}"
REDIS_URL="${redisUrl}"
INSTANCE_SECRET="${instanceSecret}"
DASHBOARD_PORT=${answers.port}
DOMAIN="${answers.domain}"
NODE_ENV="production"
`;

  await writeFile(join(serverDir, '.env'), envContent);
  console.log('✅ Created .env');

  // Generate docker-compose.yml
  if (isAuto) {
    const dockerCompose = `version: "3.8"

services:
  postgres:
    image: pgvector/pgvector:pg16
    restart: always
    environment:
      POSTGRES_USER: ai_engine
      POSTGRES_PASSWORD: ai_engine_password
      POSTGRES_DB: ai_engine
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: always
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

  dashboard:
    build:
      context: .
      dockerfile: Dockerfile
    restart: always
    ports:
      - "${answers.port}:3000"
    environment:
      DATABASE_URL: postgresql://ai_engine:ai_engine_password@postgres:5432/ai_engine
      REDIS_URL: redis://redis:6379
      INSTANCE_SECRET: ${instanceSecret}
    depends_on:
      - postgres
      - redis

volumes:
  pgdata:
  redisdata:
`;
    await writeFile(join(serverDir, 'docker-compose.yml'), dockerCompose);
    console.log('✅ Created docker-compose.yml');
  }

  // Generate Dockerfile
  const dockerfile = `FROM node:20-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

EXPOSE 3000

CMD ["node", "apps/dashboard/.next/standalone/server.js"]
`;

  await writeFile(join(serverDir, 'Dockerfile'), dockerfile);
  console.log('✅ Created Dockerfile');

  console.log(`
✅ Server configuration complete!

Next steps:
${isAuto ? '  1. Run: docker compose up -d' : '  1. Ensure your PostgreSQL and Redis are running'}
  2. Open: http://${answers.domain}${answers.port !== 80 ? ':' + answers.port : ''} in your browser
  3. Complete the setup wizard to create your admin account and add API keys
`);
}
