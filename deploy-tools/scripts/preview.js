'use strict'

// 生成预览二维码
// 用法: node scripts/preview.js [--desc 备注] [--out 输出路径(默认 ../preview-qrcode.jpg)]

const path = require('path')
const { loadConfig, newProject } = require('./lib')

async function main() {
  const args = process.argv.slice(2)
  const get = (flag) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const desc = get('--desc') || 'miniprogram-ci 预览'
  const out = path.resolve(__dirname, '..', get('--out') || 'preview-qrcode.jpg')

  const config = loadConfig()
  const ci = require('miniprogram-ci')
  const project = newProject(config)

  console.log(`生成预览二维码 -> ${out}`)
  await ci.preview({
    project,
    desc,
    setting: { useProjectConfig: true },
    qrcodeFormat: 'image',
    qrcodeOutputDest: out,
    onProgressUpdate: (info) => {
      const msg = (info && (info.status || info.message)) || ''
      if (msg) console.log(`  ${msg}`)
    },
  })
  console.log('预览二维码已生成:', out)
}

main().catch((e) => {
  console.error('预览失败:', e.message)
  process.exit(1)
})
