#!/usr/bin/env bash
# 一键部署：上传小程序代码 + 上传全部云函数
# 用法: ./deploy.sh <版本号> [备注]
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:?用法: ./deploy.sh <版本号> [备注]}"
DESC="${2:-自动部署}"

echo "########## 上传小程序代码 v${VERSION} ##########"
node scripts/upload.js --version "$VERSION" --desc "$DESC"

echo
echo "########## 上传全部云函数 ##########"
node scripts/upload-functions.js

echo
echo "部署完成 ✓"
