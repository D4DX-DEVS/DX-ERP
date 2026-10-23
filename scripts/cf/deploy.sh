#!/usr/bin/env bash
# Builds and deploys the Worker.
#
# OpenNext bundles the values of every .env* file it finds into the Worker (as fallbacks behind the
# Worker's own variables/secrets). Local files hold development secrets (the dev super-admin password,
# the dev AUTH_SECRET, …), so they are moved aside for the build and restored afterwards. Production
# configuration lives only in Worker secrets: `npx wrangler secret bulk .env.cloudflare`.
set -euo pipefail
cd "$(dirname "$0")/../.."

moved=()
restore() {
  for f in "${moved[@]:-}"; do [ -n "$f" ] && mv "$f.deploy-aside" "$f"; done
}
trap restore EXIT
for f in .env .env.local .env.development.local .env.production.local .dev.vars; do
  if [ -f "$f" ]; then mv "$f" "$f.deploy-aside"; moved+=("$f"); fi
done

npx opennextjs-cloudflare build

# Only the committed, non-secret .env.production may be bundled.
if grep -Eq 'SECRET|PASSWORD|MONGODB|_KEY"' .open-next/cloudflare/next-env.mjs; then
  echo "Refusing to deploy: secret-looking values were bundled from an env file." >&2
  exit 1
fi

npx opennextjs-cloudflare deploy -- --keep-vars
