#!/usr/bin/env bash
set -u

session_id="${1:?usage: watch-sandbox-pydantic.sh SESSION_ID SEED_SITE_PACKAGES}"
seed_site_packages="${2:?usage: watch-sandbox-pydantic.sh SESSION_ID SEED_SITE_PACKAGES}"
sandbox_root="${TRUEFORGE_SANDBOX_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/trueforge/sandboxes}"
session_root="${sandbox_root}/${session_id}"

case "$seed_site_packages" in
  "$sandbox_root"/*/.venv/lib/python3.12/site-packages) ;;
  *)
    echo "seed path must be an existing TrueForge sandbox site-packages directory" >&2
    exit 2
    ;;
esac
[ -d "$seed_site_packages" ] || {
  echo "seed path does not exist" >&2
  exit 2
}

attempt=0
while [ "$attempt" -lt 12000 ]; do
  for venv_pip in "$session_root"/*/.venv/bin/pip; do
    [ -x "$venv_pip" ] || continue
    venv_python="${venv_pip%/pip}/python"
    target_site_packages="${venv_pip%/bin/pip}/lib/python3.12/site-packages"
    "$venv_python" -c "import pydantic" >/dev/null 2>&1 || cp -a "$seed_site_packages"/. "$target_site_packages"/
  done
  attempt=$((attempt + 1))
  sleep 0.05
done
