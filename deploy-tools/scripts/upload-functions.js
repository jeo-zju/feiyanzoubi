'use strict'

// 上传云函数到微信云开发
// 用法:
//   node scripts/upload-functions.js              # 上传全部云函数
//   node scripts/upload-functions.js auth_login   # 只上传指定云函数（可多个）

const fs = require('fs')
const path = require('path')
const { loadConfig, newProject, projectPath } = require('./lib')

async function main() {
  const args = process.argv.slice(2)
  const config = loadConfig()
  const ci = require('miniprogram-ci')
  const project = newProject(config)

  const funcsRoot = path.join(projectPath(), 'cloudfunctions')
  const targets = args.length
    ? args
    : fs
        .readdirSync(funcsRoot)
        .filter((n) => fs.statSync(path.join(funcsRoot, n)).isDirectory())

  if (!targets.length) {
    console.error('cloudfunctions 目录下没有可上传的函数')
    process.exit(1)
  }

  console.log(`云环境: ${config.ENV_ID} | 待上传 ${targets.length} 个云函数`)
  for (const name of targets) {
    const dir = path.join(funcsRoot, name)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      console.error(`跳过: ${name} 不是目录或不存在`)
      continue
    }
    console.log(`上传云函数 ${name} ...`)
    const result = await ci.cloud.uploadFunction({
      project,
      env: config.ENV_ID,
      name,
      path: dir,
      remoteNpmInstall: true, // 云端安装依赖，不上传本地 node_modules
    })
    console.log(`  ${name} 完成:`, JSON.stringify(result))
  }
  console.log('全部云函数上传结束')
}

main().catch((e) => {
  console.error('云函数上传失败:', e.message)
  process.exit(1)
})
