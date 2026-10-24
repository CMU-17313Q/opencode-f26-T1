
FROM oven/bun:1.4.3

WORKDIR /app

# Install native build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Tell node-gyp where Python is
ENV PYTHON=/usr/bin/python3

COPY . .

# Install project dependencies
RUN bun install

EXPOSE 4096

CMD ["bun", "run", "--cwd", "packages/opencode", "src/index.ts", "web", "--hostname", "0.0.0.0", "--port", "4096"]

