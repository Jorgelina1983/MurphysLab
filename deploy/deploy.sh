#!/usr/bin/env bash
# Build the site and copy it to the server. Nothing but the built files is sent:
# no source, no tests and no book/ folder.
#
#   DEPLOY_HOST=usuario@mi-droplet ./deploy/deploy.sh
#   DEPLOY_HOST=usuario@mi-droplet DEPLOY_PATH=/var/www/murphy ./deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DEPLOY_HOST:?Falta DEPLOY_HOST, por ejemplo usuario@mi-droplet}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/murphy-signal-lab}"

npm run typecheck
npx vitest run
npm run build

# The trailing slash copies the contents of dist/; --delete removes files of earlier builds.
rsync -avz --delete dist/ "${DEPLOY_HOST}:${DEPLOY_PATH}/"
echo "Publicado en ${DEPLOY_HOST}:${DEPLOY_PATH}"
