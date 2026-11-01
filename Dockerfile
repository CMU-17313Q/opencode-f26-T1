FROM node:24-bookworm-slim AS node
FROM oven/bun:1.3.14

# Native dependency install scripts need Node 24, matching GitHub Actions.
COPY --from=node /usr/local/bin/node /usr/local/bin/node

WORKDIR /app

# Install native build dependencies
RUN apt-get update && apt-get install -y     python3     make     g++     git     ca-certificates     && rm -rf /var/lib/apt/lists/*

# Tell node-gyp where Python is
ENV PYTHON=/usr/bin/python3

COPY . .

# Match packageManager and install exactly the committed dependency graph.
RUN node --version && bun --version && bun install --frozen-lockfile

EXPOSE 4096

CMD ["bun", "run", "--cwd", "packages/opencode", "src/index.ts", "web", "--hostname", "0.0.0.0", "--port", "4096"]
