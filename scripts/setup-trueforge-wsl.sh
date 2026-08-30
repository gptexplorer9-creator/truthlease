#!/usr/bin/env bash
set -euo pipefail

node_version="24.20.0"
node_archive="node-v${node_version}-linux-x64.tar.xz"
node_sha256="2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2"
trueforge_version="0.1.4"
tool_root="${XDG_DATA_HOME:-${HOME}/.local/share}/truthlease"
node_root="${tool_root}/node-v${node_version}-linux-x64"
trueforge_root="${tool_root}/trueforge-${trueforge_version}"

for dependency in bwrap socat rg python3 curl tar sha256sum; do
  if ! command -v "${dependency}" >/dev/null 2>&1; then
    printf 'Missing WSL dependency: %s\n' "${dependency}" >&2
    exit 1
  fi
done

probe_output="$(
  bwrap \
    --ro-bind /usr /usr \
    --symlink usr/bin /bin \
    --symlink usr/lib /lib \
    --symlink usr/lib64 /lib64 \
    --proc /proc \
    --dev /dev \
    /bin/sh -lc 'printf BWRAP_OK'
)"
if [[ "${probe_output}" != "BWRAP_OK" ]]; then
  printf 'WSL Bubblewrap probe failed.\n' >&2
  exit 1
fi

mkdir -p "${tool_root}"
if [[ ! -x "${node_root}/bin/node" ]]; then
  temporary_directory="$(mktemp -d "${tool_root}/node-install.XXXXXX")"
  trap 'rm -rf "${temporary_directory}"' EXIT
  curl --fail --location --silent --show-error \
    "https://nodejs.org/dist/v${node_version}/${node_archive}" \
    --output "${temporary_directory}/${node_archive}"
  printf '%s  %s\n' "${node_sha256}" "${temporary_directory}/${node_archive}" | sha256sum --check -
  mkdir -p "${node_root}"
  tar --extract --xz --file "${temporary_directory}/${node_archive}" \
    --directory "${node_root}" --strip-components=1
  rm -rf "${temporary_directory}"
  trap - EXIT
fi

export PATH="${node_root}/bin:${PATH}"
mkdir -p "${trueforge_root}"
if [[ ! -f "${trueforge_root}/node_modules/@truefoundry/trueforge/package.json" ]]; then
  npm install --prefix "${trueforge_root}" --omit=dev "@truefoundry/trueforge@${trueforge_version}"
fi

printf 'TrueForge %s is ready with Node %s and native WSL Bubblewrap.\n' \
  "${trueforge_version}" "$(node --version)"
