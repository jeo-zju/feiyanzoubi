'use strict'

const fs = require('fs')
const path = require('path')

// 读取 config.env（不覆盖已存在的环境变量）
function loadConfig() {
  const envPath = path.join(__dirname, '..', 'config.env')
  const config = { ...process.env }
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (m && !config[m[1]]) {
        config[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    }
  }
  const required = ['APPID', 'ENV_ID', 'PRIVATE_KEY_PATH']
  const missing = required.filter((k) => !config[k])
  if (missing.length) {
    console.error(
      `缺少配置: ${missing.join(', ')}\n` +
        `请复制 deploy-tools/config.env.example 为 deploy-tools/config.env 并填写`
    )
    process.exit(1)
  }
  return config
}

// 仓库根目录（project.config.json 所在处）
function projectPath() {
  return path.resolve(__dirname, '..', '..')
}

function expandHome(p) {
  return p.replace(/^~/, process.env.HOME || '')
}

// 构造 miniprogram-ci Project 对象
function newProject(config) {
  const ci = require('miniprogram-ci')
  return new ci.Project({
    appid: config.APPID,
    type: 'miniProgram',
    projectPath: projectPath(),
    privateKeyPath: expandHome(config.PRIVATE_KEY_PATH),
    ignores: ['node_modules/**/*', 'deploy-tools/**/*', '.git/**/*'],
  })
}

module.exports = { loadConfig, projectPath, expandHome, newProject }
