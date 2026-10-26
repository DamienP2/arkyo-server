#!/usr/bin/env bash
# Clone les dépôts de référence aux commits fixés dans .ref/ (idempotent).
set -euo pipefail
cd "$(dirname "$0")/.."
ARKYO_COMMIT=88b2e4b245b3c11bb8e4a8989c83fe98b063582d
CG_COMMIT=8ad8b56

fetch() {
  local url=$1 dir=$2 commit=$3
  if [ ! -d ".ref/$dir/.git" ]; then
    mkdir -p .ref
    git clone "$url" ".ref/$dir"
  fi
  git -C ".ref/$dir" fetch --quiet origin || true
  git -C ".ref/$dir" checkout --quiet "$commit"
}

fetch https://github.com/DamienP2/arkyo arkyo "$ARKYO_COMMIT"
fetch https://github.com/DamienP2/CG cg "$CG_COMMIT"
