# feiyanzoubi 部署工具链（无需微信开发者工具）

基于微信官方 [miniprogram-ci](https://developers.weixin.qq.com/miniprogram/dev/devtools/ci.html)
（从微信开发者工具中抽离的编译上传模块），可在 Linux / CI / agent 环境中完成：
小程序代码上传、预览二维码、云函数上传；数据库集合创建走微信云开发 HTTP API。

## 前置条件

1. Node.js >= 16（本机 v22 ✓）
2. 代码上传密钥：微信公众平台 → 开发 → 开发设置 → 小程序代码上传密钥
   - 下载后文件名为 `private.wx96f0086fe7b2b7cd.key`，**只能下载一次**，请放仓库外
   - 如未配置 IP 白名单，miniprogram-ci 无法使用；可在公众平台配置白名单
     （服务器出口 IP），或接受风险选择不限制
3. 云环境 ID：小程序云开发控制台首页（形如 `xxx-xxx-xxx` 或 `cloud1-xxx`）
4. （仅数据库功能需要）AppSecret：公众平台 → 开发 → 开发设置

## 初始化

```bash
cd deploy-tools
./setup.sh                # 安装依赖 + 生成 config.env
vim config.env            # 填 ENV_ID / PRIVATE_KEY_PATH / APP_SECRET
```

## 常用命令（在 deploy-tools 目录下）

```bash
./deploy.sh 1.0.0 '修复了xxx'     # 一键：上传代码 + 上传全部云函数
npm run upload -- --version 1.0.1 --desc '只传代码'
npm run preview                     # 生成预览二维码 preview-qrcode.jpg
npm run functions                   # 上传全部云函数（云端装依赖）
npm run functions -- auth_login     # 只上传某个云函数
npm run db:create -- users          # 创建数据库集合 users
```

## 说明

- 云函数上传使用 `remoteNpmInstall: true`：依赖在云端安装，本地 node_modules 不上传
- `config.env`、`*.key`、`node_modules/` 已被 .gitignore 排除，不会进公开仓库
- 旧版 `../uploadCloudFunction.sh`（根目录）已被本工具链取代，子命令名也以本目录为准
  （miniprogram-ci 2.1.31 是 `cloud functions upload`，不是 `deploy`）
- 数据库操作暂只封装了「创建集合」；同一套 access_token 可扩展
  databaseadd/query/update/delete、invokecloudfunction 等接口，需要时再补

## 排错

- 上传报 `invalid ip ... not in whitelist`：公众平台配置服务器出口 IP 白名单
- 上传报 `private key` 相关错误：密钥与 appid 不匹配，或密钥路径不对
- `errno -404011` 之类：先 `npm run preview` 或开发者工具里确认能编译通过
