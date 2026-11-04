FROM node:24-bookworm-slim AS node
FROM oven/bun:1.3.14

# Native dependency install scripts need Node 24, matching GitHub Actions.
COPY --from=node /usr/local/bin/node /usr/local/bin/node

WORKDIR /app

# Install native build dependencies
RUN apt-get update && apt-get install -y python3 make g++ git ca-certificates && rm -rf /var/lib/apt/lists/*

# Tell node-gyp where Python is
ENV PYTHON=/usr/bin/python3

COPY . .

# Use the committed dependency graph and a layout compatible with native scripts.
RUN node --version && bun --version && bun install --frozen-lockfile --linker hoisted

# Serve this repo's web UI instead of proxying app.opencode.ai, so changes like "Clone from git URL" ship.
RUN OPENCODE_CHANNEL=prod bun run --cwd packages/app build
ENV OPENCODE_WEB_UI_DIR=/app/packages/app/dist

# The web UI's "Open project" dialog browses ~, so give the server a clean home that only
# holds the demo project, and keep tool caches and opencode's own data under /root.
ENV HOME=/workspace \
  XDG_CONFIG_HOME=/root/.config \
  XDG_DATA_HOME=/root/.local/share \
  XDG_CACHE_HOME=/root/.cache \
  XDG_STATE_HOME=/root/.local/state \
  BUN_INSTALL_CACHE_DIR=/root/.bun/install/cache \
  npm_config_cache=/root/.npm

# Buggy demo project from UserGuide.md, so web visitors can open ~/guided-demo and try
# guided debugging. Committed so a shared, already-fixed copy resets with `git restore .`.
COPY deploy/guided-demo /workspace/guided-demo
RUN cd /workspace/guided-demo && git init -q && git add . \
  && git -c user.name=opencode -c user.email=demo@opencode.local commit -qm "Add buggy calculator demo"

EXPOSE 4096

CMD ["bun", "run", "--cwd", "packages/opencode", "src/index.ts", "web", "--hostname", "0.0.0.0", "--port", "4096"]
