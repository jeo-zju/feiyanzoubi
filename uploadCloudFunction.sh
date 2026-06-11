#!/usr/bin/env bash

set -euo pipefail

installPath="${installPath:-miniprogram-ci}"
envId="${envId:-}"
projectPath="${projectPath:-$(pwd)}"
functionName="${1:-}"

if [[ -z "${envId}" ]]; then
  echo "请先通过环境变量设置 envId"
  exit 1
fi

if [[ -n "${functionName}" ]]; then
  "${installPath}" cloud functions deploy --e "${envId}" --n "${functionName}" --r --project "${projectPath}"
  exit 0
fi

for dir in "${projectPath}/cloudfunctions"/*; do
  [[ -d "${dir}" ]] || continue
  name="$(basename "${dir}")"
  echo "deploy ${name}"
  "${installPath}" cloud functions deploy --e "${envId}" --n "${name}" --r --project "${projectPath}"
done
