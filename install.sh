#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AI Engine — Dashboard Installer
#
# Installs all prerequisites (Node.js, pnpm, build tools), clones or updates
# the repository, builds the project, and launches the setup wizard.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/<your-repo>/main/install.sh | bash
#   -- or --
#   bash install.sh
#
# Options:
#   --port <number>    Dashboard port (default: 3000)
#   --dir  <path>      Install directory (default: /opt/ai-engine)
# ─────────────────────────────────────────────────────────────────────────────
# ── Ensure we're running under bash ──────────────────────────────────────────
# If someone runs "sh install.sh", re-exec under bash automatically.
if [ -z "$BASH_VERSION" ]; then
  exec bash "$0" "$@"
fi

set -eo pipefail

# ── Parse arguments ──────────────────────────────────────────────────────────

INSTALL_DIR="/opt/ai-engine"
DASHBOARD_PORT=3000

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) DASHBOARD_PORT="$2"; shift 2 ;;
    --dir)  INSTALL_DIR="$2"; shift 2 ;;
    *)      shift ;;
  esac
done

echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║          AI Engine — Dashboard Installer          ║"
echo "╠═══════════════════════════════════════════════════╣"
echo "║  Install dir: $(printf '%-30s' "$INSTALL_DIR")║"
echo "║  Port:        $(printf '%-30s' "$DASHBOARD_PORT")║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

OS="$(uname -s)"
ARCH="$(uname -m)"

# ── Helper functions ─────────────────────────────────────────────────────────

info()  { echo "  [INFO]  $*"; }
ok()    { echo "  [OK]    $*"; }
warn()  { echo "  [WARN]  $*"; }
fail()  { echo "  [ERROR] $*"; exit 1; }

command_exists() { command -v "$1" &>/dev/null; }

# ── 1. Install system build tools ───────────────────────────────────────────

info "Checking system build tools..."

if [[ "$OS" == "Linux" ]]; then
  if command_exists apt-get; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq curl git build-essential python3 ca-certificates gnupg >/dev/null 2>&1
    ok "apt packages installed (curl, git, build-essential, python3)"
  elif command_exists yum; then
    sudo yum install -y curl git gcc gcc-c++ make python3 ca-certificates >/dev/null 2>&1
    ok "yum packages installed"
  elif command_exists dnf; then
    sudo dnf install -y curl git gcc gcc-c++ make python3 ca-certificates >/dev/null 2>&1
    ok "dnf packages installed"
  elif command_exists pacman; then
    sudo pacman -Sy --noconfirm curl git base-devel python >/dev/null 2>&1
    ok "pacman packages installed"
  else
    warn "Unknown Linux package manager — skipping system deps."
    warn "Make sure curl, git, and build tools (gcc, make) are installed."
  fi
elif [[ "$OS" == "Darwin" ]]; then
  # Xcode Command Line Tools (provides git, clang, make)
  if ! xcode-select -p &>/dev/null; then
    info "Installing Xcode Command Line Tools..."
    xcode-select --install 2>/dev/null || true
    echo "  Waiting for Xcode CLT installation to complete..."
    until xcode-select -p &>/dev/null; do sleep 5; done
    ok "Xcode Command Line Tools installed"
  else
    ok "Xcode Command Line Tools already installed"
  fi

  # Homebrew
  if ! command_exists brew; then
    info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add brew to PATH for this session
    if [[ -f /opt/homebrew/bin/brew ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -f /usr/local/bin/brew ]]; then
      eval "$(/usr/local/bin/brew shellenv)"
    fi
    ok "Homebrew installed"
  else
    ok "Homebrew already installed"
  fi
else
  fail "Unsupported OS: $OS. This installer supports Linux and macOS."
fi

# ── 2. Install Node.js ──────────────────────────────────────────────────────

REQUIRED_NODE_MAJOR=20

if command_exists node; then
  CURRENT_NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
  if [[ "$CURRENT_NODE_MAJOR" -ge "$REQUIRED_NODE_MAJOR" ]]; then
    ok "Node.js $(node -v) already installed"
  else
    warn "Node.js $(node -v) is too old (need v${REQUIRED_NODE_MAJOR}+). Upgrading..."
    NEED_NODE=1
  fi
else
  info "Node.js not found. Installing..."
  NEED_NODE=1
fi

if [[ "${NEED_NODE:-0}" == "1" ]]; then
  if [[ "$OS" == "Darwin" ]]; then
    brew install node@20
    brew link --overwrite node@20 2>/dev/null || true
  elif [[ "$OS" == "Linux" ]]; then
    if command_exists apt-get; then
      # NodeSource for Debian/Ubuntu
      sudo mkdir -p /etc/apt/keyrings
      curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg 2>/dev/null
      echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
      sudo apt-get update -qq
      sudo apt-get install -y -qq nodejs >/dev/null 2>&1
    elif command_exists yum || command_exists dnf; then
      curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - >/dev/null 2>&1
      sudo yum install -y nodejs >/dev/null 2>&1 || sudo dnf install -y nodejs >/dev/null 2>&1
    else
      # Fallback: install via nvm-like binary download
      NODE_VERSION="v20.18.0"
      case "$ARCH" in
        x86_64|amd64) NODE_ARCH="x64" ;;
        aarch64|arm64) NODE_ARCH="arm64" ;;
        *) fail "Unsupported architecture: $ARCH" ;;
      esac
      curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" | sudo tar -xJ -C /usr/local --strip-components=1
    fi
  fi
  ok "Node.js $(node -v) installed"
fi

# ── 3. Install pnpm ─────────────────────────────────────────────────────────

if command_exists pnpm; then
  ok "pnpm $(pnpm -v) already installed"
else
  info "Installing pnpm..."
  npm install -g pnpm >/dev/null 2>&1
  ok "pnpm $(pnpm -v) installed"
fi

# ── 4. Install git (verify) ─────────────────────────────────────────────────

if ! command_exists git; then
  fail "git is required but could not be installed. Please install it manually."
fi
ok "git $(git --version | awk '{print $3}') available"

# ── 5. Clone or update the repository ───────────────────────────────────────

if [[ -f "$INSTALL_DIR/package.json" ]] && grep -q '"ai-engine"' "$INSTALL_DIR/package.json" 2>/dev/null; then
  info "Existing installation found at $INSTALL_DIR — pulling latest..."
  cd "$INSTALL_DIR"

  # Determine the remote and branch to pull from
  GIT_REMOTE="origin"
  GIT_BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")"

  # Stash any local changes (e.g. generated files not in .gitignore)
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    info "Stashing local changes before pull..."
    git stash --include-untracked -q 2>/dev/null || true
  fi

  # Fetch first, then try fast-forward merge; fall back to hard reset if diverged
  if git fetch "$GIT_REMOTE" "$GIT_BRANCH" 2>&1; then
    if git merge --ff-only "$GIT_REMOTE/$GIT_BRANCH" 2>&1; then
      ok "Updated to latest from $GIT_REMOTE/$GIT_BRANCH"
    else
      warn "Fast-forward merge not possible — resetting to remote (local commits will be lost)"
      git reset --hard "$GIT_REMOTE/$GIT_BRANCH" 2>&1
      ok "Reset to $GIT_REMOTE/$GIT_BRANCH"
    fi
  else
    warn "git fetch failed — continuing with existing code"
  fi

  # Restore stashed changes (best-effort)
  git stash pop -q 2>/dev/null || true
else
  # If we're running from inside the repo already, use that
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "$SCRIPT_DIR/package.json" ]] && grep -q '"ai-engine"' "$SCRIPT_DIR/package.json" 2>/dev/null; then
    if [[ "$SCRIPT_DIR" != "$INSTALL_DIR" ]]; then
      info "Copying repository from $SCRIPT_DIR to $INSTALL_DIR..."
      sudo mkdir -p "$INSTALL_DIR"
      sudo chown "$(whoami)" "$INSTALL_DIR"
      cp -a "$SCRIPT_DIR/." "$INSTALL_DIR/"
    fi
    cd "$INSTALL_DIR"
    ok "Using repository at $INSTALL_DIR"
  else
    info "Cloning repository to $INSTALL_DIR..."
    sudo mkdir -p "$(dirname "$INSTALL_DIR")"
    sudo chown "$(whoami)" "$(dirname "$INSTALL_DIR")" 2>/dev/null || true

    # The user must set REPO_URL, or this defaults to a placeholder
    REPO_URL="${AI_ENGINE_REPO:-https://github.com/YOUR_ORG/ai-engine.git}"
    if [[ "$REPO_URL" == *"YOUR_ORG"* ]]; then
      echo ""
      warn "No repository URL configured."
      warn "Set AI_ENGINE_REPO before running this script:"
      warn "  export AI_ENGINE_REPO=https://github.com/your-org/ai-engine.git"
      warn "  bash install.sh"
      echo ""
      fail "Cannot clone without a valid repository URL."
    fi

    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    ok "Repository cloned"
  fi
fi

# ── 6. Install dependencies ─────────────────────────────────────────────────

info "Installing Node.js dependencies..."
pnpm install 2>&1 | tail -1
ok "Dependencies installed"

# ── 7. Generate Prisma client ────────────────────────────────────────────────

info "Generating Prisma client..."
pnpm --filter @ai-engine/db exec prisma generate 2>&1 | tail -1
ok "Prisma client generated"

# ── 8. Build all packages ───────────────────────────────────────────────────

info "Building all packages (this may take a minute)..."
pnpm build
ok "Build complete"

# ── 8b. Copy Prisma engine to Next.js server dir ────────────────────────────

info "Ensuring Prisma engine is available to the Next.js server..."
PRISMA_ENGINE=$(find "$INSTALL_DIR/node_modules" -name "libquery_engine-debian*" -o -name "libquery_engine-linux*" 2>/dev/null | head -1)
NEXT_SERVER_DIR="$INSTALL_DIR/apps/dashboard/.next/server"
if [ -n "$PRISMA_ENGINE" ] && [ -d "$NEXT_SERVER_DIR" ]; then
  cp "$PRISMA_ENGINE" "$NEXT_SERVER_DIR/" 2>/dev/null || true
  ok "Prisma engine copied to Next.js server directory"
elif [ -d "$NEXT_SERVER_DIR" ]; then
  # Also try from the .prisma/client directory
  PRISMA_CLIENT_DIR=$(find "$INSTALL_DIR/node_modules" -path "*/.prisma/client" -type d 2>/dev/null | head -1)
  if [ -n "$PRISMA_CLIENT_DIR" ]; then
    cp "$PRISMA_CLIENT_DIR"/libquery_engine-* "$NEXT_SERVER_DIR/" 2>/dev/null || true
    ok "Prisma engine copied from .prisma/client"
  fi
else
  warn "Next.js server directory not found — Prisma engine will load from node_modules"
fi

# ── 9. Bundle the worker (so the dashboard can serve it to workers) ─────────

info "Creating worker bundle..."
npx --yes tsx scripts/bundle-worker.ts
ok "Worker bundle created"

# ── 10. Launch the dashboard setup ───────────────────────────────────────────

info "Starting the dashboard..."
echo ""

npx --yes tsx cli/create-server/src/index.ts --port "$DASHBOARD_PORT"
