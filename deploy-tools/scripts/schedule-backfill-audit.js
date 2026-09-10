'use strict'

// RockUserScheduleDays 回填前审计 + dry-run（只读，不写库）。
//
// 用法：
//   node deploy-tools/scripts/schedule-backfill-audit.js            # 审计 + dry-run 统计
//   node deploy-tools/scripts/schedule-backfill-audit.js --sample=50 # 打印最多 N 条冲突样例（默认 20）
//
// 前置：deploy-tools/config.env 配置 APPID / ENV_ID / APP_SECRET。
// 安全口径：
//   - 只读 RockCalendarPlans / RockCalendarJoins，绝不写任何集合；
//   - 输出只含计数与 planId/openid 标识，不含昵称、标题、备注、联系方式等私人字段；
//   - 正式回填未授权：本脚本不提供 --apply。上线步骤见 SCHEDULE_CONFLICT_ADJUSTMENT_PLAN.md 第 8 节。

const { loadConfig } = require('./lib')
const path = require('path')
const schedule = require(path.join(__dirname, '..', '..', 'cloudfunctions', 'calendar_plan_publish', 'schedule.js'))

const PAGE = 1000

async function getToken(config) {
  const url =
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential` +
    `&appid=${config.APPID}&secret=${config.APP_SECRET}`
  const tok = await (await fetch(url)).json()
  if (!tok.access_token) throw new Error('获取 access_token 失败: ' + JSON.stringify(tok))
  return tok.access_token
}

// tcb/databasequery：query 为序列化的链式调用，返回 data 是 JSON 字符串数组
async function pagedQuery(token, config, collectionName, whereExpr) {
  const rows = []
  for (let skip = 0; ; skip += PAGE) {
    const q = whereExpr
      ? `db.collection('${collectionName}').where(${whereExpr}).skip(${skip}).limit(${PAGE}).get()`
      : `db.collection('${collectionName}').skip(${skip}).limit(${PAGE}).get()`
    const r = await fetch(
      `https://api.weixin.qq.com/tcb/databasequery?access_token=${token}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ env: config.ENV_ID, query: q }) }
    )
    const data = await r.json()
    if (data.errcode !== 0) throw new Error(`${collectionName} 查询失败(skip=${skip}): ` + JSON.stringify(data))
    const list = JSON.parse(data.data || '[]')
    rows.push(...list)
    if (list.length < PAGE) return rows
  }
}

// 复刻 lifecycle.byUser：同一 (plan,uid) 取最新一条，confirmed 优先
function latestJoinOf(joins) {
  const byUser = new Map()
  joins.forEach((j) => {
    const uid = j.openid || j._openid || j.uid
    if (!uid) return
    const prev = byUser.get(uid)
    if (!prev) { byUser.set(uid, j); return }
    const prevConfirmed = ['joined', 'confirmed'].includes(prev.status)
    const curConfirmed = ['joined', 'confirmed'].includes(j.status)
    const t = (row) => Number(row.updatedAt || row.createdAt || 0)
    if (curConfirmed && !prevConfirmed) byUser.set(uid, j)
    else if (curConfirmed === prevConfirmed && t(j) >= t(prev)) byUser.set(uid, j)
  })
  return byUser
}

function uidOf(row) {
  return row.openid || row._openid || row.uid || ''
}

async function main() {
  const sampleArg = process.argv.find((a) => a.startsWith('--sample='))
  const sampleLimit = sampleArg ? Number(sampleArg.split('=')[1]) || 20 : 20

  const config = loadConfig()
  if (!config.APP_SECRET) {
    console.error('缺少 APP_SECRET（config.env）—— 云端只读查询需要')
    process.exit(1)
  }
  const token = await getToken(config)
  console.log(`[audit] env=${config.ENV_ID} 开始只读扫描 …`)

  const plans = await pagedQuery(token, config, 'RockCalendarPlans', '')
  const joins = await pagedQuery(token, config, 'RockCalendarJoins', '')
  console.log(`[audit] plans=${plans.length} joins=${joins.length}`)

  const now = Date.now()
  const stats = {
    plansTotal: plans.length,
    plansActiveFuture: 0,
    plansLegacyNoSlots: 0,
    plansUnparseableTime: 0,
    joinsTotal: joins.length,
    occupantsConfirmed: 0,
    occupantsPending: 0,
    indexMismatch: 0,
    conflicts: 0,
    backfillDocsToCreate: 0,
    backfillEntries: 0,
    usersTouched: 0
  }
  const unparseable = []
  const indexMismatch = []
  const conflicts = []

  // user|date -> [{planId,status,segments:[{startAt,endAt}]}]
  const days = new Map()
  const dayKey = (openid, date) => `${openid}|${date}`
  function addEntry(openid, date, entry) {
    const key = dayKey(openid, date)
    const list = days.get(key) || []
    list.push(entry)
    days.set(key, list)
  }

  const joinsByPlan = new Map()
  joins.forEach((j) => {
    if (!j.planId) return
    const list = joinsByPlan.get(j.planId) || []
    list.push(j)
    joinsByPlan.set(j.planId, list)
  })

  for (const plan of plans) {
    if (plan.status && plan.status !== 'active') continue
    let candidate
    try {
      candidate = schedule.candidateFromPlan(plan)
    } catch (e) {
      stats.plansUnparseableTime++
      if (unparseable.length < sampleLimit) unparseable.push({ planId: plan._id, date: plan.date || '', reason: e.message })
      continue
    }
    if (candidate.endAt <= now) continue
    stats.plansActiveFuture++
    if (!Array.isArray(plan.timeSlots) || !plan.timeSlots.length) stats.plansLegacyNoSlots++

    // 成员索引一致性（v2 才检查）：participantIds 应等于 host + 有效 pending/confirmed
    const planJoins = joinsByPlan.get(plan._id) || []
    if (Number(plan.joinSchemaVersion) === 2 && Array.isArray(plan.participantIds)) {
      const effective = new Set([uidOf(plan) || plan.openid || plan._openid || ''])
      latestJoinOf(planJoins).forEach((j, uid) => {
        if (['joined', 'confirmed', 'pending'].includes(j.status)) effective.add(uid)
      })
      effective.delete('')
      const indexed = new Set(plan.participantIds.filter(Boolean))
      const diff = effective.size !== indexed.size || [...effective].some((id) => !indexed.has(id))
      if (diff) {
        stats.indexMismatch++
        if (indexMismatch.length < sampleLimit) {
          indexMismatch.push({ planId: plan._id, indexed: indexed.size, effective: effective.size })
        }
      }
    }

    // 占用成员：发起人 host + 有效 confirmed/pending（pending 预留但不占名额）
    const occupants = [{ openid: uidOf(plan) || plan.openid || plan._openid || '', status: 'host' }]
    latestJoinOf(planJoins).forEach((j, uid) => {
      if (j.status === 'pending') occupants.push({ openid: uid, status: 'pending' })
      else if (['joined', 'confirmed'].includes(j.status)) occupants.push({ openid: uid, status: 'confirmed' })
    })

    for (const occ of occupants) {
      if (!occ.openid) continue
      if (occ.status === 'pending') stats.occupantsPending++
      else stats.occupantsConfirmed++
      Object.keys(candidate.byDate).forEach((date) => {
        addEntry(occ.openid, date, {
          planId: plan._id,
          status: occ.status,
          segments: candidate.byDate[date].map((s) => ({ startAt: s.startAt, endAt: s.endAt }))
        })
      })
    }
  }

  // 冲突检测：同一 user/date 内区间相交（端点相接允许）
  for (const [key, entries] of days) {
    for (let i = 0; i < entries.length; i++) {
      for (let k = i + 1; k < entries.length; k++) {
        const a = entries[i], b = entries[k]
        if (a.planId === b.planId) continue
        const hit = a.segments.some((sa) => b.segments.some((sb) => schedule.overlaps(sa, sb)))
        if (hit) {
          stats.conflicts++
          if (conflicts.length < sampleLimit) {
            conflicts.push({ userDate: key, planA: a.planId, planB: b.planId, statusA: a.status, statusB: b.status })
          }
        }
      }
    }
  }

  // dry-run 回填统计：每个 user/date 一条确定性 ID 文档
  const docs = []
  for (const [key, entries] of days) {
    const [openid, date] = key.split('|')
    docs.push({ _id: schedule.dayDocId(openid, date), openid, date, entryCount: entries.length })
  }
  stats.backfillDocsToCreate = docs.length
  stats.backfillEntries = docs.reduce((n, d) => n + d.entryCount, 0)
  stats.usersTouched = new Set(docs.map((d) => d.openid)).size

  const report = {
    dryRun: true,
    env: config.ENV_ID,
    scannedAt: new Date(now + 8 * 3600000).toISOString().slice(0, 19) + '+08:00',
    stats,
    samples: { conflicts, unparseableTime: unparseable, indexMismatch }
  }
  console.log(JSON.stringify(report, null, 2))

  if (stats.plansUnparseableTime) {
    console.warn(`[warn] ${stats.plansUnparseableTime} 个计划时间不可解析，已跳过；回填前需人工核对（见 samples.unparseableTime）`)
  }
  if (stats.conflicts) {
    console.warn(`[warn] 发现 ${stats.conflicts} 对现存同时段冲突占用；回填不会消除历史数据，上线前需人工处置（取消/改期其一）`)
  }
  console.log('[audit] 完成：本工具为只读 dry-run，未写入任何数据。正式回填须按计划第 8 节单独授权执行。')
}

main().catch((e) => {
  console.error('审计失败:', e.message)
  process.exit(1)
})
