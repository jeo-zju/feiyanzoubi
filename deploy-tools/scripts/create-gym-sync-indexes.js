'use strict'

// 为岩馆同步相关集合创建必要索引（微信云开发 HTTP API）
// 用法: node scripts/create-gym-sync-indexes.js
// 前置: config.env 中已配置 APP_SECRET
//
// 接口文档: https://developers.weixin.qq.com/doc/oplatform/openApi/OpenApiDoc/cloudbase-common/db-management/updateDatabaseIndex.html
// 正确端点: POST /tcb/updateindex
// direction 必须是字符串 "1" / "-1"，每个索引必须有 name，drop_indexes 必填（可空数组）

const { loadConfig } = require('./lib')

// 需要创建的索引列表
// 格式: { collection, name, keys: [{ name, direction: '1'|'-1' }], unique }
const INDEX_GROUPS = {
  RockGymSourceLinks: [
    { name: 'idx_provider_poi', keys: [{ name: 'provider', direction: '1' }, { name: 'providerPoiId', direction: '1' }], unique: true },
    { name: 'idx_gymId', keys: [{ name: 'gymId', direction: '1' }], unique: false },
    { name: 'idx_status', keys: [{ name: 'status', direction: '1' }], unique: false }
  ],
  RockGymSourceRecords: [
    { name: 'idx_idempotentKey', keys: [{ name: 'idempotentKey', direction: '1' }], unique: true },
    { name: 'idx_provider_poi', keys: [{ name: 'provider', direction: '1' }, { name: 'providerPoiId', direction: '1' }], unique: false },
    { name: 'idx_runId', keys: [{ name: 'runId', direction: '1' }], unique: false }
  ],
  RockGymReviewQueue: [
    { name: 'idx_contentHash', keys: [{ name: 'contentHash', direction: '1' }], unique: false },
    { name: 'idx_state_created', keys: [{ name: 'reviewState', direction: '1' }, { name: 'createdAt', direction: '-1' }], unique: false },
    { name: 'idx_type_state', keys: [{ name: 'reviewType', direction: '1' }, { name: 'reviewState', direction: '1' }], unique: false }
  ],
  RockGyms: [
    { name: 'idx_city_name', keys: [{ name: 'city', direction: '1' }, { name: 'normalizedName', direction: '1' }], unique: false },
    { name: 'idx_normalizedName', keys: [{ name: 'normalizedName', direction: '1' }], unique: false },
    { name: 'idx_reviewState', keys: [{ name: 'reviewState', direction: '1' }], unique: false }
  ],
  RockGymSyncRuns: [
    { name: 'idx_status_retry', keys: [{ name: 'status', direction: '1' }, { name: 'nextRetryAt', direction: '1' }], unique: false }
  ],
  RockGymSyncShards: [
    { name: 'idx_status_lease', keys: [{ name: 'status', direction: '1' }, { name: 'leaseExpiresAt', direction: '1' }], unique: false },
    { name: 'idx_runId', keys: [{ name: 'runId', direction: '1' }], unique: false }
  ]
}

async function main() {
  const config = loadConfig()
  if (!config.APP_SECRET) {
    console.error('缺少 APP_SECRET（config.env）')
    process.exit(1)
  }

  const tokenUrl =
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential` +
    `&appid=${config.APPID}&secret=${config.APP_SECRET}`
  const tok = await (await fetch(tokenUrl)).json()
  if (!tok.access_token) {
    console.error('获取 access_token 失败:', JSON.stringify(tok))
    process.exit(1)
  }

  // 先确保所有集合存在
  const collections = Object.keys(INDEX_GROUPS)
  for (const col of collections) {
    const r = await fetch(
      `https://api.weixin.qq.com/tcb/databasecollectionadd?access_token=${tok.access_token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env: config.ENV_ID, collection_name: col })
      }
    )
    const data = await r.json()
    if (data.errcode === 0) {
      console.log(`+ 创建集合 ${col}`)
    } else if (data.errcode === -501000 || /exist/i.test(data.errmsg || '')) {
      // 已存在，忽略
    } else {
      console.warn(`! 集合 ${col} 检查失败: ${data.errmsg || data.errcode}`)
    }
  }

  let created = 0
  let skipped = 0
  let failed = 0

  // 按集合批量创建索引（每个集合一次调用，包含多个 create_indexes）
  for (const [collection, indexes] of Object.entries(INDEX_GROUPS)) {
    const createIndexes = indexes.map((idx) => ({
      name: idx.name,
      unique: !!idx.unique,
      keys: idx.keys.map((k) => ({ name: k.name, direction: String(k.direction) }))
    }))

    const body = {
      env: config.ENV_ID,
      collection_name: collection,
      create_indexes: createIndexes,
      drop_indexes: []
    }

    const r = await fetch(
      `https://api.weixin.qq.com/tcb/updateindex?access_token=${tok.access_token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )
    const data = await r.json()

    if (data.errcode === 0) {
      for (const idx of indexes) {
        const keyDesc = idx.keys.map((k) => `${k.name}:${k.direction}`).join(',')
        console.log(`✓ ${collection} [${idx.name}] (${keyDesc})${idx.unique ? ' [unique]' : ''}`)
        created += 1
      }
    } else if (/exist|duplicate|already/i.test(data.errmsg || '')) {
      // 部分或全部已存在，逐个尝试以区分
      console.log(`- ${collection} 批量创建返回已存在，尝试逐个创建`)
      for (const idx of indexes) {
        const singleBody = {
          env: config.ENV_ID,
          collection_name: collection,
          create_indexes: [{
            name: idx.name,
            unique: !!idx.unique,
            keys: idx.keys.map((k) => ({ name: k.name, direction: String(k.direction) }))
          }],
          drop_indexes: []
        }
        const sr = await fetch(
          `https://api.weixin.qq.com/tcb/updateindex?access_token=${tok.access_token}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(singleBody)
          }
        )
        const sd = await sr.json()
        const keyDesc = idx.keys.map((k) => `${k.name}:${k.direction}`).join(',')
        if (sd.errcode === 0) {
          console.log(`  ✓ ${collection} [${idx.name}] (${keyDesc})`)
          created += 1
        } else if (/exist|duplicate|already/i.test(sd.errmsg || '')) {
          console.log(`  - ${collection} [${idx.name}] 已存在`)
          skipped += 1
        } else {
          console.error(`  ✗ ${collection} [${idx.name}] 失败: ${sd.errmsg || sd.errcode}`)
          failed += 1
        }
      }
    } else {
      console.error(`✗ ${collection} 批量创建失败: ${data.errmsg || data.errcode}`)
      // 仍然逐个尝试
      for (const idx of indexes) {
        const singleBody = {
          env: config.ENV_ID,
          collection_name: collection,
          create_indexes: [{
            name: idx.name,
            unique: !!idx.unique,
            keys: idx.keys.map((k) => ({ name: k.name, direction: String(k.direction) }))
          }],
          drop_indexes: []
        }
        const sr = await fetch(
          `https://api.weixin.qq.com/tcb/updateindex?access_token=${tok.access_token}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(singleBody)
          }
        )
        const sd = await sr.json()
        const keyDesc = idx.keys.map((k) => `${k.name}:${k.direction}`).join(',')
        if (sd.errcode === 0) {
          console.log(`  ✓ ${collection} [${idx.name}] (${keyDesc})`)
          created += 1
        } else if (/exist|duplicate|already/i.test(sd.errmsg || '')) {
          console.log(`  - ${collection} [${idx.name}] 已存在`)
          skipped += 1
        } else {
          console.error(`  ✗ ${collection} [${idx.name}] 失败: ${sd.errmsg || sd.errcode}`)
          failed += 1
        }
      }
    }
  }

  console.log(`\n完成: 创建 ${created}, 已存在 ${skipped}, 失败 ${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('创建索引失败:', e.message)
  process.exit(1)
})
