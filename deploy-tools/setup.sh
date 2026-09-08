#!/usr/bin/env bash
# 一键初始化部署工具链
set -euo pipefail
cd "$(dirname "$0")"

echo "==> 安装 miniprogram-ci ..."
npm install --no-fund --no-audit

if [[ ! -f config.env ]]; then
  cp config.env.example config.env
  echo "==> 已生成 config.env，请编辑填写 ENV_ID / PRIVATE_KEY_PATH / APP_SECRET"
else
  echo "==> config.env 已存在，跳过"
fi

echo "==> 完成。常用命令："
echo "    ./deploy.sh 1.0.0 '备注'              # 上传代码 + 全部云函数"
echo "    npm run preview                        # 生成预览二维码"
echo "    npm run db:create -- users             # 创建数据库集合 users"
