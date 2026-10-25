FROM oven/bun:1.3.14

# Same system deps as the devcontainer
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends git python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the repo and install dependencies
COPY . .
RUN bun install

# Avoid git "dubious ownership" errors inside the container
RUN git config --global --add safe.directory /app

EXPOSE 4096

# Bind to 0.0.0.0 so the published port is reachable from outside the container
CMD ["bun", "run", "--cwd", "packages/opencode", "src/index.ts", "web", "--port", "4096", "--hostname", "0.0.0.0"]