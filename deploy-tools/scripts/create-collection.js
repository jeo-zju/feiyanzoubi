'use strict'

// 创建云数据库集合（微信云开发 HTTP API，不需要开发者工具）
// 用法: node scripts/create-collection.js <集合名>
// 前置: config.env 中已配置 APP_SECRET（用于换取 access_token）

const { loadConfig } = require('./lib')

async function main() {
  const name = process.argv[2]
  if (!name) {
    console.error('用法: node scripts/create-collection.js <集合名>')
    process.exit(1)
  }
  const config = loadConfig()
  if (!config.APP_SECRET) {
    console.error('缺少 APP_SECRET（config.env）—— 数据库操作需要，见 config.env.example')
    process.exit(1)
  }

  // 1. 用 AppSecret 换取 access_token
  const tokenUrl =
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential` +
    `&appid=${config.APPID}&secret=${config.APP_SECRET}`
  const tok = await (await fetch(tokenUrl)).json()
  if (!tok.access_token) {
    console.error('获取 access_token 失败:', JSON.stringify(tok))
    process.exit(1)
  }

  // 2. 创建集合
  const r = await fetch(
    `https://api.weixin.qq.com/tcb/databasecollectionadd?access_token=${tok.access_token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env: config.ENV_ID, collection_name: name }),
    }
  )
  const data = await r.json()
  if (data.errcode === 0) {
    console.log(`集合 ${name} 创建成功 (env=${config.ENV_ID})`)
  } else if (data.errcode === -501000 && /ResourceExist|resource exist/i.test(data.errmsg || '')) {
    console.log(`集合 ${name} 已存在 (env=${config.ENV_ID})`)
  } else {
    console.error('创建失败:', JSON.stringify(data))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('创建集合失败:', e.message)
  process.exit(1)
})
