# Deployable opencode server image built from this checkout.
# Unlike packages/opencode/Dockerfile (used by the release pipeline with prebuilt
# binaries), this compiles the binary inside Docker so the host only needs Docker.

FROM oven/bun:1.3.14 AS build
WORKDIR /src
# Some tree-sitter grammars compile native addons during install.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN bun install
# Fixed channel/version so the build script does not need git or the npm registry.
ENV OPENCODE_CHANNEL=docker OPENCODE_VERSION=0.0.0-docker
# --skip-install: the cross-platform reinstall is only needed for multi-target release builds.
RUN bun run --cwd packages/opencode build --single --skip-install \
  && cp packages/opencode/dist/opencode-linux-*/bin/opencode /usr/local/bin/opencode

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/* \
  # Mounted repos are owned by the host user; without this git refuses to read them
  # and every project collapses into the "global" project.
  && git config --system --add safe.directory '*'
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
COPY --from=build /usr/local/bin/opencode /usr/local/bin/opencode
RUN opencode --version
WORKDIR /workspace
EXPOSE 4096
ENTRYPOINT ["opencode"]
# Bind to all interfaces; the default 127.0.0.1 is unreachable through a published port.
CMD ["serve", "--hostname", "0.0.0.0", "--port", "4096"]
