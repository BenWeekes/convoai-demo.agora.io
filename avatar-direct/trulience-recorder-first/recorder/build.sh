#!/usr/bin/env bash
set -euo pipefail
: "${AGORA_GO_SDK_ROOT:?Set AGORA_GO_SDK_ROOT to the pinned Agora Go Server SDK checkout}"
recorder_source="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
recorder_output="$(realpath -m -- "${1:?Usage: build.sh /absolute/output/recv-av}")"
recorder_module="$(mktemp -d)"
trap 'rm -rf -- "$recorder_module"' EXIT
cp "$recorder_source/go.mod" "$recorder_module/go.mod"
cp "$recorder_source/go.sum" "$recorder_module/go.sum"
cd "$recorder_source"
go mod edit -modfile="$recorder_module/go.mod" \
  "-replace=github.com/AgoraIO-Extensions/Agora-Golang-Server-SDK/v2=$(realpath -- "$AGORA_GO_SDK_ROOT")"
mkdir -p -- "$(dirname -- "$recorder_output")"
go build -mod=mod -modfile="$recorder_module/go.mod" -o "$recorder_output" .
