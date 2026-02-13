import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/install-script?token=<jwt>
 *
 * Returns a self-contained bash script that:
 *   1. Installs Node.js 20+ (if missing)
 *   2. Installs pnpm (if missing)
 *   3. Downloads the worker bundle from the dashboard
 *   4. Extracts to /opt/ai-engine-worker
 *   5. Installs npm dependencies
 *   6. Registers with the dashboard hub (receives a WebSocket auth token)
 *   7. Registers as a system service (systemd / launchd)
 *   8. Starts the worker
 *
 * Workers connect via WebSocket — no database or Redis access needed.
 *
 * Usage on the target machine:
 *   curl -sSL "https://your-dashboard.com/api/worker/install-script?token=xxx" | bash
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? 'MISSING_TOKEN';

  // Use the tunnel URL if available, otherwise fall back to the request origin
  let serverUrl = request.nextUrl.origin;
  try {
    const tunnelMod = await import('../../../../lib/tunnel-manager');
    const state = tunnelMod.TunnelManager.getInstance().getState();
    if (state.status === 'connected' && state.url) {
      serverUrl = state.url;
    }
  } catch { /* use request origin */ }

  const script = generateInstallScript(serverUrl, token);

  return new NextResponse(script, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Server-Url': serverUrl,
    },
  });
}

function generateInstallScript(serverUrl: string, token: string): string {
  return `#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AI Engine — Worker Installer
#
# Server: ${serverUrl}
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
#
# Workers connect to the dashboard via WebSocket. No database or Redis
# access is required on the worker machine.
# ─────────────────────────────────────────────────────────────────────────────
set -e

INSTALL_DIR="/opt/ai-engine-worker"
SERVER_URL="${serverUrl}"
JOIN_TOKEN="${token}"
CONFIG_DIR="\$HOME/.ai-engine"

echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║          AI Engine — Worker Installer             ║"
echo "╠═══════════════════════════════════════════════════╣"
echo "║  Server: $(printf '%-38s' '${serverUrl}')║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

OS="\$(uname -s)"
ARCH="\$(uname -m)"

info()  { echo "  [INFO]  \$*"; }
ok()    { echo "  [OK]    \$*"; }
fail()  { echo "  [ERROR] \$*"; exit 1; }

# ── 1. Install system build tools ───────────────────────────────────────────

info "Checking system prerequisites..."

if [[ "\$OS" == "Linux" ]]; then
  if command -v apt-get &>/dev/null; then
    sudo apt-get update -qq 2>/dev/null
    sudo apt-get install -y -qq curl build-essential python3 ca-certificates >/dev/null 2>&1
  elif command -v yum &>/dev/null; then
    sudo yum install -y curl gcc gcc-c++ make python3 ca-certificates >/dev/null 2>&1
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y curl gcc gcc-c++ make python3 ca-certificates >/dev/null 2>&1
  fi
elif [[ "\$OS" == "Darwin" ]]; then
  if ! xcode-select -p &>/dev/null; then
    info "Installing Xcode Command Line Tools..."
    xcode-select --install 2>/dev/null || true
    until xcode-select -p &>/dev/null; do sleep 5; done
  fi
  if ! command -v brew &>/dev/null; then
    info "Installing Homebrew..."
    /bin/bash -c "\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    [[ -f /opt/homebrew/bin/brew ]] && eval "\$(/opt/homebrew/bin/brew shellenv)"
    [[ -f /usr/local/bin/brew ]]    && eval "\$(/usr/local/bin/brew shellenv)"
  fi
fi

# ── 2. Install Node.js ──────────────────────────────────────────────────────

REQUIRED_NODE_MAJOR=20

install_node() {
  if [[ "\$OS" == "Darwin" ]]; then
    brew install node@20
    brew link --overwrite node@20 2>/dev/null || true
  elif [[ "\$OS" == "Linux" ]]; then
    if command -v apt-get &>/dev/null; then
      sudo mkdir -p /etc/apt/keyrings
      curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg 2>/dev/null
      echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
      sudo apt-get update -qq
      sudo apt-get install -y -qq nodejs >/dev/null 2>&1
    elif command -v yum &>/dev/null || command -v dnf &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - >/dev/null 2>&1
      sudo yum install -y nodejs >/dev/null 2>&1 || sudo dnf install -y nodejs >/dev/null 2>&1
    else
      NODE_VERSION="v20.18.0"
      case "\$ARCH" in
        x86_64|amd64) NODE_ARCH="x64" ;;
        aarch64|arm64) NODE_ARCH="arm64" ;;
        *) fail "Unsupported architecture: \$ARCH" ;;
      esac
      curl -fsSL "https://nodejs.org/dist/\${NODE_VERSION}/node-\${NODE_VERSION}-linux-\${NODE_ARCH}.tar.xz" | sudo tar -xJ -C /usr/local --strip-components=1
    fi
  fi
}

if command -v node &>/dev/null; then
  CURRENT_MAJOR=\$(node -v | sed 's/v//' | cut -d. -f1)
  if [[ "\$CURRENT_MAJOR" -ge "\$REQUIRED_NODE_MAJOR" ]]; then
    ok "Node.js \$(node -v)"
  else
    info "Node.js \$(node -v) is too old (need v\${REQUIRED_NODE_MAJOR}+). Upgrading..."
    install_node
    ok "Node.js \$(node -v)"
  fi
else
  info "Installing Node.js..."
  install_node
  ok "Node.js \$(node -v)"
fi

# ── 3. Install pnpm ─────────────────────────────────────────────────────────

if command -v pnpm &>/dev/null; then
  ok "pnpm \$(pnpm -v)"
else
  info "Installing pnpm..."
  npm install -g pnpm >/dev/null 2>&1
  ok "pnpm \$(pnpm -v)"
fi

# ── 4. Download worker bundle ───────────────────────────────────────────────

info "Downloading worker bundle from \$SERVER_URL..."
sudo mkdir -p "\$INSTALL_DIR"
sudo chown "\$(whoami)" "\$INSTALL_DIR"

BUNDLE_FILE="\$INSTALL_DIR/worker-bundle.tar.gz"
HTTP_CODE=\$(curl -sSL -o "\$BUNDLE_FILE" -w "%{http_code}" "\$SERVER_URL/api/worker/bundle")

if [[ "\$HTTP_CODE" != "200" ]] || [[ ! -f "\$BUNDLE_FILE" ]]; then
  fail "Failed to download worker bundle (HTTP \$HTTP_CODE). Has the dashboard been built?"
fi

BUNDLE_SIZE=\$(stat -f%z "\$BUNDLE_FILE" 2>/dev/null || stat -c%s "\$BUNDLE_FILE" 2>/dev/null)
if [[ "\$BUNDLE_SIZE" -lt 1000 ]]; then
  fail "Worker bundle is too small (\$BUNDLE_SIZE bytes). The dashboard may not have the bundle built."
fi

ok "Bundle downloaded (\$(( BUNDLE_SIZE / 1024 / 1024 )) MB)"

# ── 5. Extract bundle ───────────────────────────────────────────────────────

info "Extracting worker bundle..."
cd "\$INSTALL_DIR"
tar -xzf worker-bundle.tar.gz
rm -f worker-bundle.tar.gz
ok "Bundle extracted to \$INSTALL_DIR"

# ── 6. Install dependencies ─────────────────────────────────────────────────

info "Installing Node.js dependencies..."
cd "\$INSTALL_DIR"
# The bundle ships without a lockfile (the monorepo lockfile doesn't match the
# worker's trimmed package.json), so we skip --frozen-lockfile entirely.
pnpm install --prod --no-frozen-lockfile 2>&1 | tail -5 || npm install --production 2>&1 | tail -5
ok "Dependencies installed"

# ── 7. Register with the dashboard ──────────────────────────────────────────

info "Registering with the dashboard..."
mkdir -p "\$CONFIG_DIR"

REGISTER_RESULT=\$(curl -sSL -X POST "\$SERVER_URL/api/hub/register-worker" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"token\\": \\"\$JOIN_TOKEN\\",
    \\"hostname\\": \\"\$(hostname)\\",
    \\"os\\": \\"\$(uname -s | tr '[:upper:]' '[:lower:]')\\",
    \\"capabilities\\": {
      \\"os\\": \\"\$(uname -s | tr '[:upper:]' '[:lower:]')\\",
      \\"hasDisplay\\": \$(if [[ "\$OS" == "Darwin" ]]; then echo "true"; else echo "false"; fi),
      \\"browserCapable\\": \$(if [[ "\$OS" == "Darwin" ]]; then echo "true"; else echo "false"; fi),
      \\"environment\\": \\"local\\",
      \\"customTags\\": []
    }
  }")

# Extract workerId and token from JSON response
WORKER_ID=\$(echo "\$REGISTER_RESULT" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).workerId)}catch{console.log('')}})")
WORKER_TOKEN=\$(echo "\$REGISTER_RESULT" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).token)}catch{console.log('')}})")

if [[ -z "\$WORKER_ID" ]] || [[ "\$WORKER_ID" == "undefined" ]]; then
  echo ""
  echo "  Registration response: \$REGISTER_RESULT"
  fail "Failed to register with the dashboard. Check the token and try again."
fi

ok "Registered as worker \$WORKER_ID"

# ── 8. Save configuration ───────────────────────────────────────────────────

cat > "\$CONFIG_DIR/worker.json" << WORKERCONF
{
  "workerId": "\$WORKER_ID",
  "workerSecret": "\$WORKER_TOKEN",
  "serverUrl": "\$SERVER_URL",
  "environment": "local",
  "customTags": []
}
WORKERCONF
chmod 600 "\$CONFIG_DIR/worker.json"
ok "Config saved to \$CONFIG_DIR/worker.json"

# ── 9. Create start script ──────────────────────────────────────────────────

NODE_PATH=\$(which node)
cat > "\$INSTALL_DIR/start-worker.sh" << 'STARTEOF'
#!/usr/bin/env bash
set -e
cd "\$(dirname "\$0")"

# Load config from the JSON file
CONFIG_FILE="\${HOME}/.ai-engine/worker.json"
if [[ -f "\$CONFIG_FILE" ]]; then
  export SERVER_URL=\$(node -e "console.log(JSON.parse(require('fs').readFileSync('\$CONFIG_FILE','utf8')).serverUrl)")
  export WORKER_SECRET=\$(node -e "console.log(JSON.parse(require('fs').readFileSync('\$CONFIG_FILE','utf8')).workerSecret)")
  export WORKER_ID=\$(node -e "console.log(JSON.parse(require('fs').readFileSync('\$CONFIG_FILE','utf8')).workerId)")
fi

export NODE_ENV=production
exec node apps/worker/dist/index.js
STARTEOF
chmod 755 "\$INSTALL_DIR/start-worker.sh"

# ── 10. Register as system service ──────────────────────────────────────────

CURRENT_USER=\$(whoami)

if [[ "\$OS" == "Linux" ]]; then
  info "Registering systemd service..."
  sudo tee /etc/systemd/system/ai-engine-worker.service > /dev/null << SVCEOF
[Unit]
Description=AI Engine Worker (\$WORKER_ID)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=\$CURRENT_USER
WorkingDirectory=\$INSTALL_DIR
ExecStart=/usr/bin/env bash \$INSTALL_DIR/start-worker.sh
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ai-engine-worker

[Install]
WantedBy=multi-user.target
SVCEOF

  sudo systemctl daemon-reload
  sudo systemctl enable ai-engine-worker
  sudo systemctl start ai-engine-worker

  ok "systemd service registered and started"

elif [[ "\$OS" == "Darwin" ]]; then
  info "Registering LaunchDaemon..."
  PLIST_PATH="/Library/LaunchDaemons/com.ai-engine.worker.plist"
  LOG_DIR="/usr/local/var/log/ai-engine"

  sudo mkdir -p "\$LOG_DIR"
  sudo chown "\$CURRENT_USER" "\$LOG_DIR"

  sudo tee "\$PLIST_PATH" > /dev/null << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ai-engine.worker</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>\$INSTALL_DIR/start-worker.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>\$INSTALL_DIR</string>
    <key>UserName</key>
    <string>\$CURRENT_USER</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>\$LOG_DIR/worker.log</string>
    <key>StandardErrorPath</key>
    <string>\$LOG_DIR/worker.err</string>
</dict>
</plist>
PLISTEOF

  sudo chown root:wheel "\$PLIST_PATH"
  sudo chmod 644 "\$PLIST_PATH"
  sudo launchctl unload "\$PLIST_PATH" 2>/dev/null || true
  sudo launchctl load "\$PLIST_PATH"

  ok "LaunchDaemon registered and started"
else
  echo ""
  echo "  Unsupported OS for auto-service registration."
  echo "  Start the worker manually:"
  echo "    cd \$INSTALL_DIR && bash start-worker.sh"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║  ✅ Worker installed and running!                 ║"
echo "╠═══════════════════════════════════════════════════╣"
echo "║                                                   ║"
echo "║  Worker ID:   $(printf '%-30s' "\$WORKER_ID")║"
echo "║  Install dir: $(printf '%-30s' "\$INSTALL_DIR")║"
echo "║  Config:      $(printf '%-30s' "\$CONFIG_DIR/worker.json")║"
echo "║  Connects to: $(printf '%-30s' "\$SERVER_URL")║"
echo "║                                                   ║"
echo "║  The worker connects via WebSocket.               ║"
echo "║  No database or Redis access needed.              ║"
echo "║                                                   ║"
echo "║  It will automatically:                           ║"
echo "║    • Start on boot                                ║"
echo "║    • Restart if it crashes                        ║"
echo "║    • Reconnect if the dashboard restarts          ║"
echo "║                                                   ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""
echo "  View logs:"
if [[ "\$OS" == "Linux" ]]; then
  echo "    journalctl -u ai-engine-worker -f"
elif [[ "\$OS" == "Darwin" ]]; then
  echo "    tail -f /usr/local/var/log/ai-engine/worker.log"
fi
echo ""
`;
}
