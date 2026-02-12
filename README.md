# AI Engine

A distributed AI agent orchestration system designed to run as a **24/7 autonomous employee**. Coordinate multiple specialized agents across a cluster of heterogeneous machines, manage complex workflows, maintain persistent memory, and automate tasks through a modern web UI.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Quick Start (Dashboard)](#quick-start-dashboard)
- [Setup Wizard](#setup-wizard)
- [Adding Worker Nodes](#adding-worker-nodes)
  - [How Workers Communicate](#how-workers-communicate)
  - [Worker Capabilities](#worker-capabilities)
  - [Agent-to-Agent Communication](#agent-to-agent-communication)
- [PostgreSQL & Redis Setup](#postgresql--redis-setup)
  - [PostgreSQL](#postgresql)
  - [Redis](#redis)
  - [Manual .env (Alternative)](#manual-env-alternative-to-the-setup-wizard)
- [Cloudflare Tunnel](#cloudflare-tunnel)
- [Service Management](#service-management)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Configuration Reference](#configuration-reference)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                     Cloud / Server (Dashboard Host)                     │
│                                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐   │
│  │ PostgreSQL   │  │    Redis     │  │   Dashboard + Worker Hub   │   │
│  │ + pgvector   │  │             │  │   Next.js + WebSocket      │   │
│  │              │  │             │  │   HTTP & WS on :3000       │   │
│  └──────┬───────┘  └──────┬──────┘  └─────────────┬──────────────┘   │
│         │                 │                        │                  │
│         └────── localhost only ─────┘              │                  │
│                                                    │                  │
│  ┌─────────────────────────────────────────────────┴───────────────┐  │
│  │                    Cloudflare Tunnel                             │  │
│  │  https://random-name.trycloudflare.com  (or your custom domain) │  │
│  └──────────────────────────┬──────────────────────────────────────┘  │
└─────────────────────────────┼────────────────────────────────────────┘
                              │  WebSocket (wss://) + HTTPS
              ┌───────────────┼───────────────────────────┐
              │               │                           │
        ┌─────┴─────┐  ┌─────┴─────┐              ┌─────┴─────┐
        │ Worker A  │  │ Worker B  │              │ Worker C  │
        │ (macOS)   │  │ (Linux)   │    . . .     │ (Cloud)   │
        │ Browser   │  │ Headless  │              │ Headless  │
        │ capable   │  │ only      │              │ only      │
        └───────────┘  └───────────┘              └───────────┘
              ▲               ▲                         ▲
              └──── Agent-to-Agent calls routed via Hub ────┘
```

**Key design principle:** PostgreSQL and Redis are only accessible from the dashboard host (typically `localhost`). Workers connect to the dashboard over a **single WebSocket connection** through the Cloudflare Tunnel. Workers never need direct database or Redis access.

- **Dashboard + WebSocket Hub** -- The central web UI, REST API, and real-time worker communication hub. Serves both HTTP and WebSocket on the same port. The hub handles task dispatch, heartbeats, configuration push, and agent-to-agent call routing.
- **Workers** -- Lightweight Node.js processes that connect to the dashboard via `wss://<tunnel-url>/ws/worker`. They receive task assignments, execute agents, and report results. Workers automatically reconnect if the dashboard restarts.
- **Cloudflare Tunnel** -- Automatically started when the dashboard boots. Provides out-of-the-box HTTPS + WSS access without manual SSL, DNS, or firewall configuration. The tunnel URL is printed to the console so you can access the dashboard from your local browser even when the server is headless.
- **PostgreSQL + pgvector** -- Primary data store and vector database for semantic memory. Dashboard-only.
- **Redis** -- Pub/sub, distributed locks, caching, and leader election. Dashboard-only.

---

## Quick Start (Dashboard)

The dashboard is the central server. It is typically deployed on a cloud VM (accessed via SSH). You do **not** need a graphical desktop -- the tunnel provides a public HTTPS URL you open in your local browser.

### One-command install

SSH into your server and run:

```bash
git clone <your-repo-url> ai-engine
cd ai-engine
bash install.sh
```

That's it. The `install.sh` script handles **everything**:
- Installs system build tools (`curl`, `git`, `gcc`, `make`, etc.)
- Installs Node.js 20 (via NodeSource on Linux, Homebrew on macOS)
- Installs pnpm
- Installs all Node.js dependencies (`pnpm install`)
- Builds all packages (`pnpm build`)
- Creates the worker bundle (so the dashboard can serve it to workers)
- Launches the dashboard setup CLI

You can customize the install with flags:

```bash
bash install.sh --port 8080 --dir /opt/ai-engine
```

### Manual install (if you prefer)

```bash
# 1. Install Node.js 20+ and pnpm yourself
# 2. Clone and build
git clone <your-repo-url> ai-engine
cd ai-engine
pnpm install
pnpm build

# 3. Launch the server
npx tsx cli/create-server/src/index.ts
```

### What happens next

The setup CLI will:

1. Generate a `.env` file with a secure `INSTANCE_SECRET`
2. Register the dashboard as a **system service** (systemd on Linux, LaunchDaemon on macOS) so it auto-starts on boot and restarts on crash
3. Start the dashboard process
4. Start a Cloudflare Tunnel
5. **Wait for the tunnel URL and print it to your terminal**

You will see output like this:

```
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   AI Engine is ready!                                        ║
║                                                              ║
║   Open this URL in your browser to complete setup:           ║
║                                                              ║
║   https://abc-xyz-123.trycloudflare.com/setup                ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

Copy that URL and open it in your local browser. This is the setup wizard.

You can optionally pass `--port 8080` to use a different port.

> **If the tunnel URL doesn't appear**, the server logs will have it. Check with:
> - Linux: `journalctl -u ai-engine-dashboard -f`
> - macOS: `tail -f /usr/local/var/log/ai-engine/dashboard.log`
>
> Look for the line: `[tunnel] Setup wizard: https://...`

---

## Setup Wizard

The first time you open the dashboard, you are taken to a guided setup wizard at `/setup`. The wizard walks you through every step needed to get the system running:

| Step | What It Does |
|------|-------------|
| **1. Database** | Enter your PostgreSQL connection string and test the connection. Or click **Install Automatically** to have it installed on the server for you. |
| **2. Redis** | Enter your Redis connection string and test the connection. Or click **Install Automatically**. |
| **3. Initialize** | Saves the configuration, runs database migrations (`prisma migrate`), and restarts the server. |
| **4. Admin Account** | Create your first admin user (email, password, display name). |
| **5. Create Team** | Optionally create your first team (can be skipped). |
| **6. API Keys** | Add one or more Claude API keys. Multiple keys are load-balanced automatically. |
| **7. Vault Passphrase** | Set the master passphrase that encrypts all stored credentials (API keys, website logins, etc.). |
| **8. Add Worker** | Generates a join command you can run on other machines to connect worker nodes. |
| **9. Done** | Redirects you to the main dashboard. |

The tunnel URL is displayed as a banner at the top of the setup wizard so you can copy it at any time.

After setup is complete, go to **Settings > Domain & Tunnel** to optionally configure a custom domain with your Cloudflare account (so the URL stays the same across restarts).

---

## Adding Worker Nodes

Workers are the execution backbone. They run on separate machines (cloud VMs, local Macs, etc.) and connect to the dashboard over WebSocket through the tunnel. **Workers do not need PostgreSQL or Redis access.**

### Joining a Worker

On the dashboard, go to **Workers** or the **Setup Wizard** (step 8) to get the worker install command. It looks like:

```bash
curl -sSL "https://abc-xyz-123.trycloudflare.com/api/worker/install-script?token=eyJhbG..." | bash
```

That single command handles **everything** on the worker machine:

1. Installs system build tools, Node.js 20, and pnpm (if missing)
2. Downloads the pre-built worker bundle from the dashboard
3. Installs Node.js dependencies
4. Registers with the dashboard hub (receives a WebSocket auth token)
5. Saves config to `~/.ai-engine/worker.json`
6. Registers a system service (systemd on Linux, launchd on macOS)
7. Starts the worker immediately

The worker does **not** need the git repository, a database, or Redis. Everything is pulled from the dashboard.

The worker config is minimal:

```json
{
  "workerId": "a1b2c3d4-...",
  "workerSecret": "eyJhbG...",
  "serverUrl": "https://abc-xyz-123.trycloudflare.com",
  "environment": "local",
  "customTags": []
}
```

**Alternative:** If you have the repo cloned on the worker machine, you can also use the CLI directly:

```bash
npx @ai-engine/join-worker \
  --server https://abc-xyz-123.trycloudflare.com \
  --token eyJhbGciOi...
```

### How Workers Communicate

All communication happens over a single WebSocket at `wss://<dashboard-url>/ws/worker`:

| Message | Direction | Description |
|---------|-----------|-------------|
| `auth` | Worker -> Hub | Worker sends its JWT on connect |
| `auth:ok` | Hub -> Worker | Dashboard confirms and sends config |
| `heartbeat` | Worker -> Hub | Load and active task count, every 10s |
| `task:assign` | Hub -> Worker | Dashboard dispatches a task to the best worker |
| `task:complete` | Worker -> Hub | Worker reports task success + output |
| `task:failed` | Worker -> Hub | Worker reports task failure + error |
| `agent:call` | Either direction | Agent-to-agent call, routed through the hub |
| `agent:response` | Either direction | Response to an agent call |
| `config:update` | Hub -> Workers | Dashboard pushes config changes to all workers |
| `update:available` | Hub -> Workers | New version notification |

The hub selects the best worker for each task based on:
- **Capabilities** (browser-capable, OS, display)
- **Current load** (CPU load average)
- **Active task count** (least busy worker wins)

### Worker Capabilities

Workers automatically detect their capabilities on startup:

| Capability | macOS | Linux | Description |
|-----------|-------|-------|-------------|
| `browserCapable` | Yes | No | Can run Puppeteer browser automation |
| `hasDisplay` | Yes | No | Has a graphical display |
| `environment` | auto | auto | `local` or `cloud` (from config) |

- **macOS workers** get browser tools and can handle web interaction tasks (form filling, scraping, testing). Each task gets its own isolated browser session; multiple sessions run concurrently.
- **Linux workers** handle headless tasks: code execution, API calls, file processing, scheduled jobs.
- **All workers** can run agents, access the LLM pool, use the memory system, query the vault, and execute scheduled tasks.

### Agent-to-Agent Communication

Agents can call other agents, even across different workers:

1. Agent A (on Worker 1) calls `callAgent('agentB', input)`
2. Worker 1 sends an `agent:call` message to the dashboard hub
3. The hub loads Agent B's config from the database, picks the best available worker
4. Worker 2 receives the call, executes Agent B, sends back `agent:response`
5. The hub routes the response to Worker 1, which returns it to Agent A

This is transparent to the agent -- it simply calls another agent and gets a response.

---

## PostgreSQL & Redis Setup

PostgreSQL and Redis are only needed on the **dashboard host**. The setup wizard can install them automatically, or you can set them up manually.

### PostgreSQL

AI Engine requires PostgreSQL 16+ with the **pgvector** extension for vector similarity search.

**Ubuntu / Debian:**

```bash
sudo apt update
sudo apt install -y postgresql-16 postgresql-16-pgvector
sudo systemctl enable postgresql
sudo systemctl start postgresql

sudo -u postgres psql <<SQL
CREATE USER ai_engine WITH PASSWORD 'your_secure_password';
CREATE DATABASE ai_engine OWNER ai_engine;
\c ai_engine
CREATE EXTENSION IF NOT EXISTS vector;
SQL
```

**macOS (Homebrew):**

```bash
brew install postgresql@16 pgvector
brew services start postgresql@16

psql postgres <<SQL
CREATE USER ai_engine WITH PASSWORD 'your_secure_password';
CREATE DATABASE ai_engine OWNER ai_engine;
\c ai_engine
CREATE EXTENSION IF NOT EXISTS vector;
SQL
```

**Managed cloud (AWS RDS, Supabase, Neon, etc.):**

Provision a PostgreSQL 16+ instance and run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**Connection string format:**

```
postgresql://ai_engine:your_secure_password@localhost:5432/ai_engine
```

### Redis

Redis is used for pub/sub, distributed locks, leader election, and caching.

**Ubuntu / Debian:**

```bash
sudo apt update
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

**macOS (Homebrew):**

```bash
brew install redis
brew services start redis
```

**Windows:** Use [WSL2](https://learn.microsoft.com/en-us/windows/wsl/) or [Memurai](https://www.memurai.com/).

**Connection string format:**

```
redis://localhost:6379
redis://default:your_password@your-host:6379
```

### Manual .env (Alternative to the Setup Wizard)

If you prefer to skip the wizard, pre-populate the `.env` file:

```env
DATABASE_URL="postgresql://ai_engine:your_secure_password@localhost:5432/ai_engine"
REDIS_URL="redis://localhost:6379"
INSTANCE_SECRET="your_64_char_hex_secret_here"
DASHBOARD_PORT=3000
NODE_ENV="production"
```

Generate the secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run migrations manually:

```bash
pnpm --filter @ai-engine/db exec prisma generate
pnpm --filter @ai-engine/db exec prisma migrate dev --name init
```

The setup wizard will detect the existing database and skip to the admin account step.

---

## Cloudflare Tunnel

The dashboard automatically starts a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) on boot. This provides:

- **HTTPS + WSS** without manual SSL certificates
- **Public URL** accessible from anywhere (workers, your browser, mobile)
- **No firewall or port forwarding** required

### Quick Tunnel (Default)

On first boot, a "quick tunnel" is created with a random `*.trycloudflare.com` URL. This URL changes each time the server restarts.

The URL is:
- Printed to the console by the install CLI
- Printed to the server logs on every boot
- Shown as a banner on the setup wizard page
- Available via `GET /api/tunnel/status`

### Custom Domain (Persistent)

To get a **permanent URL** that survives restarts:

1. Go to **Settings > Domain & Tunnel** in the dashboard
2. Enter your Cloudflare API token, account ID
3. Select a zone (domain) from your Cloudflare account
4. Enter a hostname (e.g., `ai.yourdomain.com`)
5. Click **Configure**

The dashboard will:
- Create a named tunnel via the Cloudflare API
- Configure ingress rules to route traffic to the dashboard
- Create a DNS CNAME record pointing to the tunnel
- Persist the configuration in the database
- Restart the tunnel with the new settings

The URL is now permanent: `https://ai.yourdomain.com`

---

## Service Management

Both the dashboard and workers are registered as system services during installation. They start on boot and restart on failure automatically.

### Linux (systemd)

| Service | Unit Name | Unit File |
|---------|-----------|-----------|
| Dashboard | `ai-engine-dashboard` | `/etc/systemd/system/ai-engine-dashboard.service` |
| Worker | `ai-engine-worker` | `/etc/systemd/system/ai-engine-worker.service` |

```bash
# Check status
sudo systemctl status ai-engine-dashboard

# View logs (live)
journalctl -u ai-engine-dashboard -f

# Restart
sudo systemctl restart ai-engine-dashboard

# Stop (temporary -- starts again on boot)
sudo systemctl stop ai-engine-dashboard

# Disable (prevent starting on boot)
sudo systemctl disable ai-engine-dashboard
```

### macOS (launchd)

| Service | Label | Plist File |
|---------|-------|------------|
| Dashboard | `com.ai-engine.dashboard` | `/Library/LaunchDaemons/com.ai-engine.dashboard.plist` |
| Worker | `com.ai-engine.worker` | `/Library/LaunchDaemons/com.ai-engine.worker.plist` |

```bash
# Check if running
sudo launchctl list | grep ai-engine

# View logs
tail -f /usr/local/var/log/ai-engine/dashboard.log

# Stop
sudo launchctl unload /Library/LaunchDaemons/com.ai-engine.dashboard.plist

# Start
sudo launchctl load /Library/LaunchDaemons/com.ai-engine.dashboard.plist
```

### Windows

Auto-registration is not supported. The install CLI prints instructions for [NSSM](https://nssm.cc/) or Task Scheduler.

### What Happens on Reboot

| Event | Linux (systemd) | macOS (launchd) |
|-------|-----------------|-----------------|
| System boots | Starts all enabled units | Loads all LaunchDaemons |
| Process crashes | `Restart=always` restarts after 5s | `KeepAlive` restarts immediately |
| Repeated crashes | Pauses after 5 failures in 60s | `ThrottleInterval` waits 5s between |
| Tunnel | Auto-restarts with the dashboard | Auto-restarts with the dashboard |
| Workers | Auto-reconnect to dashboard WebSocket | Auto-reconnect to dashboard WebSocket |

---

## Project Structure

```
ai-engine/
├── apps/
│   ├── dashboard/               # Next.js 14 web UI + WebSocket hub
│   │   ├── server.js            # Custom entry point (HTTP + WS on same port)
│   │   ├── src/
│   │   │   ├── app/             # Next.js App Router pages
│   │   │   │   ├── (dashboard)/ # Main dashboard pages (agents, workers, chat, etc.)
│   │   │   │   ├── setup/       # First-run setup wizard
│   │   │   │   └── api/         # REST API routes
│   │   │   │       ├── hub/     # WebSocket hub endpoints (dispatch, workers, broadcast)
│   │   │   │       ├── tunnel/  # Cloudflare tunnel management
│   │   │   │       ├── auth/    # Login, registration
│   │   │   │       ├── setup/   # Setup wizard endpoints (install DB, test connections)
│   │   │   │       └── ...      # Agents, workflows, schedules, vault, memory, etc.
│   │   │   └── lib/
│   │   │       ├── worker-hub.ts    # WebSocket hub (task dispatch, agent routing)
│   │   │       ├── tunnel-manager.ts # Cloudflare tunnel lifecycle
│   │   │       └── cloudflared.ts    # cloudflared binary management
│   │   └── next.config.mjs
│   │
│   └── worker/                  # Worker node process
│       └── src/
│           ├── index.ts         # Entry point
│           ├── worker.ts        # Main worker logic (connects via WebSocket)
│           └── dashboard-client.ts  # WebSocket client with auto-reconnect
│
├── packages/
│   ├── shared/             # Types, Zod schemas, config defaults, WS protocol types
│   ├── db/                 # Prisma schema & client (PostgreSQL + pgvector)
│   ├── cluster/            # Node registry, leader election, config sync
│   ├── llm/                # Claude API pool with multi-key load balancing
│   ├── auth/               # User auth, teams, sessions, chat classification
│   ├── memory/             # Memory storage, goal tracking, context building, embeddings
│   ├── workflow-engine/    # Workflows, state machine, task routing, DAG dependencies
│   ├── scheduler/          # Cron-like scheduler with watchdog & exactly-once execution
│   ├── agent-runtime/      # Agent execution loop, tool registry, per-task tool isolation
│   ├── browser/            # Puppeteer pool with per-task session isolation
│   ├── web-search/         # Brave Search API integration & page fetching
│   ├── skills/             # Skill library, semantic search, auto-learning
│   ├── vault/              # Encrypted credential storage (AES-256-GCM + Argon2)
│   ├── planner/            # Conversational planning & task graph generation
│   └── file-sync/          # Cross-node file registry & transfer
│
├── cli/
│   ├── create-server/      # Dashboard install CLI (generates .env, registers service)
│   └── join-worker/        # Worker join CLI (registers with hub, registers service)
│
├── scripts/
│   └── bundle-worker.ts    # Bundles the worker for distribution from the dashboard
│
├── turbo.json              # Turborepo build pipeline
├── pnpm-workspace.yaml     # pnpm workspace config
└── .env                    # Environment variables (generated by create-server)
```

---

## Environment Variables

These are set in the `.env` file on the dashboard host. Workers do not use `.env` -- they receive their config from the dashboard over WebSocket.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | -- | PostgreSQL connection string (dashboard only) |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection string (dashboard only) |
| `INSTANCE_SECRET` | Yes | -- | 64-char hex for signing JWTs and tokens |
| `DASHBOARD_PORT` | No | `3000` | Port the dashboard listens on |
| `NODE_ENV` | No | `development` | `production` or `development` |

**Dev-mode overrides** (for local development without the setup wizard):

| Variable | Description |
|----------|-------------|
| `WORKER_ID` | Override the auto-generated worker ID |
| `WORKER_SECRET` | Worker JWT token (skip dashboard registration) |
| `SERVER_URL` | Dashboard URL for dev workers (`http://localhost:3000`) |
| `ENVIRONMENT` | `local` or `cloud` |

---

## Configuration Reference

All configuration is managed through the dashboard **Settings** page. Changes are pushed to all connected workers in real-time via WebSocket.

### LLM

| Key | Default | Description |
|-----|---------|-------------|
| `llm.defaultTier` | `standard` | Default model tier |
| `llm.defaultMaxTokens` | `4096` | Max output tokens per call |
| `llm.defaultTemperature` | `0.7` | Sampling temperature |

| Tier | Model | Use Case |
|------|-------|----------|
| `fast` | Claude 3.5 Haiku | Classification, simple routing, chat detection |
| `standard` | Claude Sonnet | General tasks, coding, analysis |
| `heavy` | Claude Opus | Complex reasoning, planning, multi-step workflows |

### Scheduler

| Key | Default | Description |
|-----|---------|-------------|
| `scheduler.tickIntervalMs` | `1000` | Scheduler check interval |
| `scheduler.watchdogThresholdMs` | `5000` | Stall detection threshold |
| `scheduler.watchdogMaxMissedTicks` | `3` | Max missed ticks before alert |

### Memory

| Key | Default | Description |
|-----|---------|-------------|
| `memory.contextWindowTokenLimit` | `180000` | Max context window tokens |
| `memory.maxRetrievedMemories` | `10` | Memories returned per query |
| `memory.embeddingDimension` | `1536` | Vector embedding dimensions |

### Browser

| Key | Default | Description |
|-----|---------|-------------|
| `browser.poolSize` | `3` | Max concurrent browser sessions per worker |
| `browser.defaultTimeoutMs` | `30000` | Page load / action timeout |
| `browser.sessionIdleTimeoutMs` | `300000` | Auto-reclaim idle sessions (5 min) |

### Vault

| Key | Default | Description |
|-----|---------|-------------|
| `vault.defaultApprovalMode` | `notify` | `notify` or `require_approval` for agent-created credentials |
| `vault.argon2MemoryCost` | `65536` | Argon2 memory parameter (64 MB) |

### Cluster

| Key | Default | Description |
|-----|---------|-------------|
| `cluster.heartbeatIntervalMs` | `3000` | Worker heartbeat interval |
| `cluster.heartbeatTtlMs` | `10000` | Time before worker considered dead |
| `cluster.leaderLockTtlMs` | `10000` | Leader election lock TTL |

---

## Development

```bash
# Install dependencies
pnpm install

# Run everything in dev mode (hot reload)
pnpm dev

# Build all packages
pnpm build

# Type-check all packages
pnpm typecheck

# Run tests
pnpm test

# Clean all build artifacts
pnpm clean
```

### Working on a Specific Package

```bash
# Build one package and its dependencies
pnpm turbo build --filter=@ai-engine/browser

# Run only the dashboard in dev mode
pnpm --filter @ai-engine/dashboard dev

# Run only the worker in dev mode
pnpm --filter @ai-engine/worker dev
```

### Database Development

```bash
# Create a new migration
pnpm --filter @ai-engine/db exec prisma migrate dev --name describe_your_change

# Reset the database (destructive)
pnpm --filter @ai-engine/db exec prisma migrate reset

# Open Prisma Studio (visual database browser)
pnpm --filter @ai-engine/db exec prisma studio

# Regenerate the Prisma client
pnpm --filter @ai-engine/db exec prisma generate
```

### Running the Custom Server Locally

In dev mode, `pnpm dev` uses `next dev` which does not start the WebSocket hub or Cloudflare tunnel. To test the full stack locally:

```bash
# Build first
pnpm build

# Start the custom server (includes WebSocket hub + tunnel)
cd apps/dashboard
node server.js
```

---

## Troubleshooting

### "I can't access the setup wizard"

The dashboard is on a headless server with no browser. You access it through the Cloudflare Tunnel URL.

**How to find the URL:**
1. The install CLI prints it after setup
2. Check the service logs: `journalctl -u ai-engine-dashboard -f`
3. Look for: `[tunnel] Setup wizard: https://...`
4. Or call the API: `curl http://localhost:3000/api/tunnel/status`

### Tunnel not connecting

If `cloudflared` fails to download or start:
- Check internet connectivity from the server
- Check that outbound port 7844 is open (used by Cloudflare tunnels)
- The server will retry every 5 seconds automatically
- You can still access the dashboard locally via `http://localhost:3000` if you have SSH port forwarding set up

### Worker can't connect to the dashboard

1. Verify the dashboard URL is reachable from the worker: `curl https://<tunnel-url>/api/health`
2. Ensure the join token is valid (generate a new one from the dashboard)
3. Check the worker logs: `journalctl -u ai-engine-worker -f`
4. The worker auto-reconnects every 5 seconds -- if the dashboard was temporarily down, it will recover

### PostgreSQL: "extension vector does not exist"

Install pgvector:

```bash
# Ubuntu/Debian
sudo apt install postgresql-16-pgvector

# macOS
brew install pgvector
```

Then enable it:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Redis: "ECONNREFUSED 127.0.0.1:6379"

Redis is not running:

```bash
# Linux
sudo systemctl start redis-server

# macOS
brew services start redis
```

### Worker: "Browser initialization failed"

This is expected on headless Linux servers -- Puppeteer requires a display. Use Linux workers for headless tasks only and macOS workers for browser tasks.

### Build errors: "Cannot find module"

```bash
pnpm install
pnpm build
```

Turborepo handles build order automatically. If a single package fails:

```bash
pnpm turbo build --filter=@ai-engine/package-name
```

### Service not starting on boot (Linux)

```bash
# Check if enabled
sudo systemctl is-enabled ai-engine-dashboard

# Enable if disabled
sudo systemctl enable ai-engine-dashboard

# Check for errors
journalctl -u ai-engine-dashboard --no-pager -n 50
```

### Service not starting on boot (macOS)

```bash
# Check if loaded
sudo launchctl list | grep ai-engine

# Load if missing
sudo launchctl load /Library/LaunchDaemons/com.ai-engine.dashboard.plist

# Check error log
cat /usr/local/var/log/ai-engine/dashboard.err
```

### Service registration failed during install

If the CLI prints "Service registration failed", `sudo` was likely unavailable. Re-run:

```bash
# Dashboard
npx tsx cli/create-server/src/index.ts

# Worker
npx tsx cli/join-worker/src/index.ts --server <url> --token <token>
```

---

## License

Private -- All rights reserved.
