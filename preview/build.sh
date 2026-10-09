#!/usr/bin/env bash
# Preview site build (Render). Builds the app and fetches the PostgREST binary.
set -euo pipefail
npm ci --no-audit --no-fund
npm run build
(cd preview && npm ci --no-audit --no-fund)
mkdir -p preview/bin
curl -fsSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar -xJ -C preview/bin
preview/bin/postgrest --version
