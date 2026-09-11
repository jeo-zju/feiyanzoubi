'use strict'

// 演示用户素材导入工具（D1）：
//   全量读取本地目录图片 → 解码校验 / EXIF 方向校正 / 居中裁切 / 压缩去元数据
//   → 上传云存储 demo-assets/<assetVersion>/<hash>.jpg
//   → upsert RockDemoAssets 与 67 个 accountType:"demo" 的 RockUsers 资料。
//
// 云函数无法读取本地磁盘，因此素材准备只在本机执行；管理员日常点按钮时不再依赖电脑目录。
// 重复执行按内容哈希复用资源，不修改原图，不做人工筛选。
//
// 用法：
//   node scripts/demo-assets-import.js                 # 全量处理 + 上传 + 写库
//   node scripts/demo-assets-import.js --dry-run       # 只处理本地图片并输出体积，不触网
//   node scripts/demo-assets-import.js "D:\otherDir"   # 指定源目录
//
// 前置：deploy-tools/config.env 配置 APPID / ENV_ID / APP_SECRET。

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { loadConfig } = require('./lib')

const ASSET_VERSION = 'v1'
const DATASET_ID = 'demo-core-v1'
const AVATAR_SIZE = 512
const MAX_ASSET_BYTES = 120 * 1024
const QUALITY_STEPS = [85, 76, 68, 60]
const DEFAULT_SOURCE_DIR = 'C:\\Users\\jeo\\Pictures\\mockUser'
const OUT_DIR = path.join(__dirname, '..', 'demo-assets')
const IMAGE_RE = /\.(jpe?g|png)$/i

const { buildDemoProfile, demoOpenId, demoUserIdForIndex } =
  require(path.resolve(__dirname, '..', '..', 'cloudfunctions', 'demo_data_manage', 'profile.js'))

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ---------- 微信 access_token（带缓存与过期重试） ----------
let tokenCache = { value: '', expiresAt: 0 }
async function getAccessToken(config, force) {
  if (!force && tokenCache.value && Date.now() < tokenCache.expiresAt - 60000) return tokenCache.value
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${config.APPID}&secret=${config.APP_SECRET}`
  const r = await (await fetch(url)).json()
  if (!r.access_token) throw new Error('获取 access_token 失败: ' + JSON.stringify(r))
  tokenCache = { value: r.access_token, expiresAt: Date.now() + Number(r.expires_in || 7200) * 1000 }
  return r.access_token
}

async function apiPost(url, bodyObj) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) })
  return r.json()
}

// 数据库调用失败可按 errcode 重试（token 失效时强制刷新一次）
async function dbApi(tokenRef, pathSuffix, payload) {
  let resp = await apiPost(`https://api.weixin.qq.com/tcb/${pathSuffix}?access_token=${tokenRef.t}`, payload)
  if (resp.errcode === 40001 || resp.errcode === 42001) {
    tokenRef.t = await getAccessToken(tokenRef.config, true)
    resp = await apiPost(`https://api.weixin.qq.com/tcb/${pathSuffix}?access_token=${tokenRef.t}`, payload)
  }
  return resp
}

async function ensureCollection(tokenRef, name) {
  const resp = await dbApi(tokenRef, 'databasecollectionadd', { env: tokenRef.config.ENV_ID, collection_name: name })
  if (resp.errcode === 0 || (resp.errcode === -501000 && /ResourceExist|resource exist/i.test(resp.errmsg || ''))) return
  // 集合已存在在部分环境返回其它 errcode，这里仅记录不中断（后续写库仍会给出真实错误）
  console.warn(`  集合 ${name} 预创建返回: errcode=${resp.errcode} ${resp.errmsg || ''}`)
}

async function dbFindOne(tokenRef, collection, expr) {
  const q = `db.collection("${collection}").where(${JSON.stringify(expr)}).limit(1).get()`
  const resp = await dbApi(tokenRef, 'databasequery', { env: tokenRef.config.ENV_ID, query: q })
  if (resp.errcode !== 0) throw new Error(`${collection} 查询失败: ` + JSON.stringify(resp))
  const rows = (resp.data || []).map(s => { try { return JSON.parse(s) } catch (_) { return null } }).filter(Boolean)
  return rows[0] || null
}

async function dbUpsert(tokenRef, collection, id, doc) {
  const existing = await dbFindOne(tokenRef, collection, { _id: id })
  // tcb HTTP API：databaseadd 不允许在数据中携带 _id；自定义主键必须走 doc(id).set（不存在即创建）
  const method = existing ? 'update' : 'set'
  const resp = await dbApi(tokenRef, 'databaseupdate', {
    env: tokenRef.config.ENV_ID,
    query: `db.collection("${collection}").doc(${JSON.stringify(id)}).${method}({data:${JSON.stringify(doc)}})`
  })
  if (resp.errcode !== 0) throw new Error(`${collection} ${existing ? '更新' : '新增'}失败: ` + JSON.stringify(resp))
  return existing ? 'updated' : 'inserted'
}

// ---------- 云存储上传（tcb/uploadfile + COS multipart） ----------
function buildMultipart(fields, fileBuf) {
  const boundary = '----demoAssetBoundary' + crypto.randomBytes(8).toString('hex')
  const chunks = []
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'))
  }
  chunks.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="asset.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`, 'utf8'))
  chunks.push(fileBuf)
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

async function uploadAsset(tokenRef, cloudPath, fileBuf) {
  const meta = await dbApi(tokenRef, 'uploadfile', { env: tokenRef.config.ENV_ID, path: cloudPath })
  if (meta.errcode !== 0 || !meta.url) throw new Error('uploadfile 失败: ' + JSON.stringify(meta))
  const form = buildMultipart({
    key: cloudPath,
    Signature: meta.authorization,
    'x-cos-security-token': meta.token,
    'x-cos-meta-fileid': meta['x-cos-meta-fileid']
  }, fileBuf)
  const cosRes = await fetch(meta.url, { method: 'POST', headers: { 'Content-Type': form.contentType }, body: form.body })
  if (!cosRes.ok && cosRes.status !== 204) {
    throw new Error(`COS 上传失败 HTTP ${cosRes.status}: ${(await cosRes.text()).slice(0, 300)}`)
  }
  const fileID = meta.file_id || meta.fileID || ''
  if (!fileID) throw new Error('uploadfile 未返回 file_id: ' + JSON.stringify(meta))
  return fileID
}

// ---------- 图片处理：EXIF 方向 + 居中 aspectFill + 重压 JPEG ----------
function exifOrientation(buf) {
  try {
    const parser = require('exif-parser').create(buf)
    const tags = parser.parse().tags || {}
    const n = Number(tags.Orientation || 1)
    return n >= 1 && n <= 8 ? n : 1
  } catch (_) {
    return 1
  }
}

function applyOrientation(image, Jimp, orientation) {
  switch (orientation) {
    case 2: image.flip(true, false); break
    case 3: image.rotate(180); break
    case 4: image.flip(false, true); break
    // 5/7 为“镜像+旋转”复合变换，顺序不能反（以 6=顺时针90° 为锚点按 EXIF 矩阵推导）
    case 5: image.flip(true, false); image.rotate(90); break
    case 6: image.rotate(90); break
    case 7: image.flip(true, false); image.rotate(270); break
    case 8: image.rotate(270); break
    default: break
  }
}

async function deriveAsset(sourceBuf) {
  const Jimp = require('jimp')
  const orientation = exifOrientation(sourceBuf)
  const image = await Jimp.read(sourceBuf)
  applyOrientation(image, Jimp, orientation)
  image.cover(AVATAR_SIZE, AVATAR_SIZE, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE)
  let out = null, quality = QUALITY_STEPS[0]
  for (const q of QUALITY_STEPS) {
    quality = q
    out = await image.quality(q).getBufferAsync(Jimp.MIME_JPEG)
    if (out.length <= MAX_ASSET_BYTES) break
  }
  return { buf: out, width: AVATAR_SIZE, height: AVATAR_SIZE, quality, orientation, sourceWidth: image.bitmap.width, sourceHeight: image.bitmap.height }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const sourceDir = path.resolve(args.find(a => !a.startsWith('--')) || DEFAULT_SOURCE_DIR)
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    console.error(`源目录不存在: ${sourceDir}`)
    process.exit(1)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const config = loadConfig()
  if (!dryRun && !config.APP_SECRET) {
    console.error('缺少 APP_SECRET（config.env），上传与写库需要；仅本地处理请加 --dry-run')
    process.exit(1)
  }
  const tokenRef = { config, t: '' }
  if (!dryRun) {
    tokenRef.t = await getAccessToken(config)
    await ensureCollection(tokenRef, 'RockDemoAssets')
    await ensureCollection(tokenRef, 'RockUsers')
  }

  // 文件名排序决定 demoUserId 序号，保证“同图同身份”跨批次稳定
  const files = fs.readdirSync(sourceDir).filter(n => IMAGE_RE.test(n)).sort()
  console.log(`源目录 ${sourceDir}：${files.length} 张图片；assetVersion=${ASSET_VERSION}；dry-run=${dryRun}`)

  const manifest = { assetVersion: ASSET_VERSION, datasetId: DATASET_ID, sourceDir, exportedAt: 0, files: [], errors: [] }
  const bySourceSha = new Map()
  let uploaded = 0, reused = 0, usersWritten = 0, processed = 0

  for (let i = 0; i < files.length; i++) {
    const name = files[i]
    const full = path.join(sourceDir, name)
    const recBase = { sourceFile: name, index: i + 1 }
    let sourceBuf
    try {
      sourceBuf = fs.readFileSync(full)
    } catch (e) {
      manifest.errors.push({ ...recBase, stage: 'read', error: e.message })
      console.error(`[读取失败] ${name}: ${e.message}`)
      continue
    }
    const sourceSha = sha256(sourceBuf)
    const dup = bySourceSha.get(sourceSha)
    if (dup) {
      // 相同内容复用既有资源，但保留“文件→资料”的映射（不做视觉筛选）
      manifest.files.push({ ...recBase, sourceSha, assetSha: dup.assetSha, demoUserId: dup.demoUserId, status: 'duplicate', reusedFrom: dup.sourceFile })
      console.log(`[内容重复] ${name} → 复用 ${dup.sourceFile}（${dup.demoUserId}）`)
      continue
    }

    let derived
    try {
      derived = await deriveAsset(sourceBuf)
    } catch (e) {
      manifest.errors.push({ ...recBase, sourceSha, stage: 'decode', error: e.message })
      console.error(`[解码失败] ${name}: ${e.message}`)
      continue
    }
    const assetSha = sha256(derived.buf)
    const demoUserId = demoUserIdForIndex(i + 1)
    const cloudPath = `demo-assets/${ASSET_VERSION}/${assetSha}.jpg`
    const localOut = path.join(OUT_DIR, `${assetSha.slice(0, 16)}.jpg`)
    fs.writeFileSync(localOut, derived.buf)

    const fileRec = {
      ...recBase, sourceSha, assetSha, demoUserId, status: 'ready',
      bytes: derived.buf.length, width: derived.width, height: derived.height,
      quality: derived.quality, exifOrientation: derived.orientation,
      sourceWidth: derived.sourceWidth, sourceHeight: derived.sourceHeight,
      cloudPath, fileID: '', derivedLocal: path.relative(path.join(__dirname, '..'), localOut)
    }

    if (dryRun) {
      manifest.files.push(fileRec)
      processed++
      console.log(`[dry-run] ${name} → ${derived.buf.length} 字节 q${derived.quality} 方向=${derived.orientation}`)
      continue
    }

    try {
      const existingAsset = await dbFindOne(tokenRef, 'RockDemoAssets', { _id: 'da_' + assetSha.slice(0, 32) })
      let fileID = existingAsset && existingAsset.fileID ? existingAsset.fileID : ''
      if (!fileID) {
        fileID = await uploadAsset(tokenRef, cloudPath, derived.buf)
        uploaded++
        await sleep(120) // 温和限速
      } else {
        reused++
      }
      fileRec.fileID = fileID
      const now = Date.now()
      const assetDoc = {
        assetVersion: ASSET_VERSION, datasetId: DATASET_ID, demoUserId,
        sourceFile: name, sourceSha, assetSha, fileID, cloudPath,
        bytes: derived.buf.length, width: derived.width, height: derived.height,
        contentType: 'image/jpeg', status: 'ready', error: '', importedAt: existingAsset ? existingAsset.importedAt : now, updatedAt: now
      }
      await dbUpsert(tokenRef, 'RockDemoAssets', 'da_' + assetSha.slice(0, 32), assetDoc)

      // 同步写入/修复模拟身份（部署期一次性建池；云端 demo_data_manage#provision_identities 可再次对账）
      const profile = buildDemoProfile(i + 1, { assetSha, fileID })
      const userDoc = {
        openid: profile.openid, uid: profile.openid,
        accountType: 'demo', datasetId: DATASET_ID, demoUserId,
        demoCity: '', demoAllocated: false,
        avatarFileId: fileID, avatarUrl: fileID,
        nickName: profile.nickName, displayName: profile.nickName,
        city: '', bio: profile.bio, climbSkills: profile.climbSkills,
        demoProfile: profile.demoProfile,
        role: 'user', rockId: '',
        createdAt: existingAsset ? (existingAsset.importedAt || Date.now()) : Date.now(),
        updatedAt: Date.now()
      }
      const before = await dbFindOne(tokenRef, 'RockUsers', { openid: profile.openid })
      if (before) {
        // 只补演示字段，绝不覆盖任何真实登录产生的字段
        const upd = await dbApi(tokenRef, 'databaseupdate', {
          env: config.ENV_ID,
          query: `db.collection("RockUsers").doc(${JSON.stringify(before._id)}).update({data:${JSON.stringify({
            accountType: 'demo', datasetId: DATASET_ID, demoUserId, avatarFileId: fileID,
            demoProfile: profile.demoProfile, updatedAt: Date.now()
          })}})`
        })
        if (upd.errcode !== 0) throw new Error('RockUsers 更新失败: ' + JSON.stringify(upd))
      } else {
        // tcb HTTP JS 沙箱里 add/update/set 均要求 {data: ...} 包裹
        const add = await dbApi(tokenRef, 'databaseadd', {
          env: config.ENV_ID,
          query: `db.collection("RockUsers").add({data:${JSON.stringify(userDoc)}})`
        })
        if (add.errcode !== 0) throw new Error('RockUsers 新增失败: ' + JSON.stringify(add))
      }
      usersWritten++
      manifest.files.push(fileRec)
      bySourceSha.set(sourceSha, { assetSha, demoUserId, sourceFile: name })
      processed++
      console.log(`[就绪 ${processed}/${files.length}] ${name} → ${demoUserId} ${(derived.buf.length / 1024).toFixed(1)}KB`)
    } catch (e) {
      fileRec.status = 'error'
      fileRec.error = e.message
      manifest.files.push(fileRec)
      manifest.errors.push({ ...recBase, sourceSha, assetSha, stage: 'upload', error: e.message })
      console.error(`[上传/写库失败] ${name}: ${e.message}`)
    }
  }

  manifest.exportedAt = Date.now()
  const manifestPath = path.join(OUT_DIR, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log('---')
  console.log(`完成：就绪 ${processed} / ${files.length}，新上传 ${uploaded}，复用 ${reused}，身份写入 ${usersWritten}，失败 ${manifest.errors.length}`)
  console.log(`派生资源目录：${OUT_DIR}`)
  console.log(`清单：${manifestPath}`)
  if (manifest.errors.length) {
    console.error('存在技术性失败项；修复后重新运行本工具即可续跑（成功项自动复用）。')
    process.exit(2)
  }
  if (processed + manifest.files.filter(f => f.status === 'duplicate').length < files.length) process.exit(2)
}

main().catch(e => {
  console.error('导入工具异常退出:', e.stack || e.message)
  process.exit(1)
})
