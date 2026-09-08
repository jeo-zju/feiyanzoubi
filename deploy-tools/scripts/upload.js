'use strict'

// 上传小程序代码
// 用法: node scripts/upload.js [--version 1.0.0] [--desc 备注]

const { loadConfig, newProject } = require('./lib')

async function main() {
  const args = process.argv.slice(2)
  const get = (flag) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const version = get('--version') || '1.0.0'
  const desc = get('--desc') || 'miniprogram-ci 自动上传'

  const config = loadConfig()
  const ci = require('miniprogram-ci')
  const project = newProject(config)

  console.log(`上传小程序代码 appid=${config.APPID} version=${version}`)
  const result = await ci.upload({
    project,
    version,
    desc,
    setting: { useProjectConfig: true },
    onProgressUpdate: (info) => {
      const msg = (info && (info.status || info.message)) || ''
      if (msg) console.log(`  ${msg}`)
    },
  })
  console.log('上传成功:', JSON.stringify(result))
}

main().catch((e) => {
  console.error('上传失败:', e.message)
  process.exit(1)
})
