#!/usr/bin/env bash
set -euo pipefail

node_version="24.20.0"
trueforge_version="0.1.4"
tool_root="${XDG_DATA_HOME:-${HOME}/.local/share}/truthlease"
node_root="${tool_root}/node-v${node_version}-linux-x64"
trueforge_root="${tool_root}/trueforge-${trueforge_version}"

if [[ ! -x "${node_root}/bin/node" ]] || \
   [[ ! -f "${trueforge_root}/node_modules/@truefoundry/trueforge/dist/main.js" ]]; then
  printf 'Run scripts/setup-trueforge-wsl.sh first.\n' >&2
  exit 1
fi

export PATH="${node_root}/bin:${PATH}"
export NODE_ENV=production
export STANDALONE=true
export HOST=127.0.0.1
export PORT=8790
export HOME="${tool_root}/home"
export SQLITE_PATH="${tool_root}/trueforge.db"
export LOCAL_SANDBOX_ROOT_PARENT="${tool_root}/sandboxes"
export CODE_MODE_SOCKET_PARENT="${tool_root}/code-mode"

mkdir -p "${HOME}" "${LOCAL_SANDBOX_ROOT_PARENT}" "${CODE_MODE_SOCKET_PARENT}"
exec node "${trueforge_root}/node_modules/@truefoundry/trueforge/dist/main.js"
