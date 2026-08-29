#!/usr/bin/env bash
set -u

session_id="${1:?usage: watch-sandbox-pydantic.sh SESSION_ID}"
attempt=0
while [ "$attempt" -lt 600 ]; do
  for venv_pip in "/home/rahul_k/.local/share/trueforge/sandboxes/${session_id}"/*/.venv/bin/pip; do
    [ -x "$venv_pip" ] || continue
    venv_python="${venv_pip%/pip}/python"
    "$venv_python" -c "import pydantic" >/dev/null 2>&1 || \
      "$venv_pip" install --disable-pip-version-check "pydantic>=2.0.0,<3.0.0" >/dev/null 2>&1
  done
  attempt=$((attempt + 1))
  sleep 0.2
done
