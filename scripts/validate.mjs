#!/usr/bin/env node
// EternaPlugins 索引与 bundle 仓库一致性校验（CI 与发布前必跑）。
//
// 两层校验：
// 1. market/index.json 走上游同款解析器 @deepseek-ai/dsh-plugin-market-index
//    parseMarketIndex——与宿主 plugin-market 服务零漂移（格式 1 / commit 钉版 /
//    图标 URL / 版本降序等全部规则由上游承担）；
// 2. 逐条目仓库一致性（上游管不到的面）：
//    - git 源的 bundle 目录在本仓存在、package.json 与索引条目对齐
//      （name 一致、bundle 版本 = 索引最新版本）；
//    - dsh.bundle.patch 声明与补丁文件存在，insert 行必带 id（裸 id 行只覆写
//      既有行，基础树无此 id 时整行丢弃——glue-bundle 2026-11-04 E2E 教训）；
//    - 入口为 .js/.mjs；bundle 目录禁发 .ts（Node 24 type-stripping 拒 .ts
//      under node_modules，*.d.ts 豁免）；
//    - 依赖纪律：@deepseek-ai/* 一律 peerDependencies；dependencies /
//      optionalDependencies / peerDependencies 规格必须是 registry 范围
//      （pnpm 11 blockExoticSubdeps 拒 git/file/link/workspace 子依赖）；
//    - 客户端半边（如有 dsh.client）：inject 非空 + exports['./client'] 目标
//      文件存在。
//
// 用法：node scripts/validate.mjs [--index <path>]
// 退出码：0 全绿；1 有错误（全部发现一次性列出）。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// 本仓的规范索引 URL：与 README/docs 宣传的接入地址一致。
// ⚠️ 仓库改名/迁移时同步改这里、README.md、docs/PUBLISHING.md。
export const CANONICAL_REPO_URL = 'https://github.com/mahingbun-dev/eterna-plugins'
export const INDEX_URL = 'https://raw.githubusercontent.com/mahingbun-dev/eterna-plugins/main/market/index.json'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const warnings = []
const notes = []

function fail(message) {
  errors.push(message)
}
function warn(message) {
  warnings.push(message)
}
function note(message) {
  notes.push(message)
}

// ── 依赖可用性（fail-closed：上游解析器缺失直接红，不做本地降级仿制品）────────
const require = createRequire(import.meta.url)
let parseMarketIndex
try {
  ;({ parseMarketIndex } = await import('@deepseek-ai/dsh-plugin-market-index'))
} catch (error) {
  console.error('✗ 缺依赖 @deepseek-ai/dsh-plugin-market-index（上游格式 1 校验器）。')
  console.error('  请先 `pnpm install` 安装 devDependencies；不用本地仿制品校验，保证与宿主规则零漂移。')
  console.error(`  原始错误：${error?.message ?? error}`)
  process.exit(1)
}

let semver
try {
  semver = (await import('semver')).default
} catch (error) {
  console.error('✗ 缺依赖 semver（版本降序比较用）。请先 `pnpm install`。')
  console.error(`  原始错误：${error?.message ?? error}`)
  process.exit(1)
}

let yamlParse
try {
  yamlParse = (await import('yaml')).parse
} catch (error) {
  console.error('✗ 缺依赖 yaml（补丁文件解析用）。请先 `pnpm install`。')
  console.error(`  原始错误：${error?.message ?? error}`)
  process.exit(1)
}

// ── 读索引 ────────────────────────────────────────────────────────────────
const indexArg = process.argv.indexOf('--index')
const indexPath = indexArg >= 0 ? resolve(process.argv[indexArg + 1]) : join(repoRoot, 'market', 'index.json')
if (!existsSync(indexPath)) {
  console.error(`✗ 索引文件不存在：${relative(repoRoot, indexPath)}`)
  process.exit(1)
}

let rawIndex
try {
  rawIndex = JSON.parse(readFileSync(indexPath, 'utf8'))
} catch (error) {
  console.error(`✗ 索引不是合法 JSON：${error.message}`)
  process.exit(1)
}

// ── 第 1 层：上游格式 1 校验（含 commit 钉版 / 图标 / 版本唯一与降序）────────
let parsed
try {
  parsed = parseMarketIndex(rawIndex, INDEX_URL)
} catch (error) {
  fail(`上游格式 1 校验失败：${error?.message ?? error}`)
  parsed = null
}

// ── 第 2 层：仓库一致性（用原始 JSON，避免解析器丢弃未知成员后漏检）──────────
function registrySpecOnly(spec, where) {
  if (typeof spec !== 'string' || spec.length === 0) {
    fail(`${where}：依赖规格必须是字符串（拿到 ${JSON.stringify(spec)}）`)
    return
  }
  const exotic = /^((git\+)?(ssh|https?):\/\/|git:|file:|link:|workspace:|\/|\.{1,2}\/)/
  if (exotic.test(spec.trim())) {
    fail(`${where}：非 registry 规格 "${spec}"（git/file/link/workspace 均被 pnpm 11 blockExoticSubdeps 拒绝；git 源请走索引 versions[].source 钉 commit）`)
  }
}

async function checkBundleDir(dir, entry, version) {
  const abs = resolve(repoRoot, dir)
  const where = `bundle ${dir}`
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    fail(`插件 ${entry.name} v${version.version}：bundle 目录不存在：${dir}`)
    return
  }
  if (relative(repoRoot, abs).startsWith('..') || resolve(repoRoot) === abs) {
    fail(`${where}：路径越出仓库根`)
    return
  }

  // 禁发 .ts（*.d.ts 豁免）
  const walk = (current, prefix) => {
    for (const name of readdirSync(current)) {
      const child = join(current, name)
      const rel = prefix ? `${prefix}/${name}` : name
      if (statSync(child).isDirectory()) {
        if (name === 'node_modules' || name === '.git') continue
        walk(child, rel)
        continue
      }
      if (/\.(mts|cts)$/.test(name) || (/\.ts$/.test(name) && !/\.d\.ts$/.test(name))) {
        fail(`${where}：发现 ${rel}——bundle 只发 .js/.mjs（Node type-stripping 拒 .ts under node_modules），TS 源码请经 scripts/build-bundle.mjs 编译后入库`)
      }
    }
  }
  walk(abs, '')

  // package.json 形状
  const manifestPath = join(abs, 'package.json')
  if (!existsSync(manifestPath)) {
    fail(`${where}：缺 package.json`)
    return
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    fail(`${where}：package.json 不是合法 JSON：${error.message}`)
    return
  }
  if (manifest.name !== entry.name) {
    fail(`${where}：package.json name "${manifest.name}" ≠ 索引条目 name "${entry.name}"`)
  }
  if (manifest.version !== version.version) {
    fail(`${where}：package.json version "${manifest.version}" ≠ 索引条目版本 "${version.version}"（发布 = 先提交对应版本 bundle，再写索引条目）`)
  }

  // 依赖纪律
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = manifest[field]
    if (deps === undefined) continue
    if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) {
      fail(`${where}：${field} 必须是对象`)
      continue
    }
    for (const [name, spec] of Object.entries(deps)) registrySpecOnly(spec, `${where} ${field}[${name}]`)
  }
  for (const deepName of Object.keys(manifest.dependencies ?? {})) {
    if (deepName.startsWith('@deepseek-ai/') && !(manifest.peerDependencies?.[deepName])) {
      fail(`${where}：@deepseek-ai/* 包 ${deepName} 出现在 dependencies——dsh/cordis 包一律 peerDependencies（宿主已提供，双装即版本漂移）`)
    }
  }

  // dsh.bundle.patch
  const patchRef = manifest.dsh?.bundle?.patch
  if (typeof patchRef !== 'string' || patchRef.length === 0) {
    fail(`${where}：缺 dsh.bundle.patch 声明（bundle 清单必须指向补丁文件）`)
  } else {
    const patchPath = resolve(abs, patchRef)
    if (!existsSync(patchPath)) {
      fail(`${where}：补丁文件不存在：${patchRef}`)
    } else {
      let patchDoc
      try {
        patchDoc = yamlParse(readFileSync(patchPath, 'utf8'))
      } catch (error) {
        fail(`${where}：补丁不是合法 YAML：${error.message}`)
        patchDoc = null
      }
      if (Array.isArray(patchDoc)) {
        patchDoc.forEach((row, i) => {
          const at = `${where} 补丁第 ${i + 1} 行`
          if (row && typeof row === 'object' && Array.isArray(row.insert)) {
            row.insert.forEach((inserted, j) => {
              if (!inserted || typeof inserted !== 'object' || typeof inserted.id !== 'string' || inserted.id.length === 0) {
                fail(`${at} insert[${j}]：insert 行必须带非空 id（applyPatches 对无 id 新增行不收敛）`)
              }
              if (!inserted || typeof inserted.name !== 'string' || inserted.name.length === 0) {
                fail(`${at} insert[${j}]：insert 行必须带 name（装载包/子路径）`)
              }
            })
          } else if (row && typeof row === 'object') {
            if (typeof row.id !== 'string' || row.id.length === 0) {
              fail(`${at}：覆写行必须带 id；新增行必须用 - insert:（裸 id 行在基础树无此 id 时被整行丢弃）`)
            }
          } else {
            fail(`${at}：既非 insert 块也非覆写行`)
          }
        })
      }
    }
  }

  // 客户端半边
  if (manifest.dsh?.client) {
    const inject = manifest.dsh.client.inject
    if (!Array.isArray(inject) || inject.length === 0) {
      fail(`${where}：dsh.client.inject 必须是非空数组（客户端模块注入依赖清单）`)
    }
    const clientExport = manifest.exports?.['./client']
    if (clientExport === undefined) {
      fail(`${where}：声明了 dsh.client 但缺 exports['./client']`)
    } else {
      const target = typeof clientExport === 'string' ? clientExport : clientExport?.default
      if (typeof target !== 'string') {
        fail(`${where}：exports['./client'] 目标无法解析`)
      } else if (!existsSync(resolve(abs, target))) {
        fail(`${where}：exports['./client'] 目标不存在：${target}（先跑 build:client 产出 window.__ModuleLoader__ 工件再入库）`)
      }
    }
  }

  // 入口可执行面：main/exports 目标一律 .js/.mjs
  const entryTargets = []
  if (typeof manifest.main === 'string') entryTargets.push(manifest.main)
  for (const [key, target] of Object.entries(manifest.exports ?? {})) {
    if (key === './package.json') continue
    if (typeof target === 'string') entryTargets.push(target)
    else if (target && typeof target.default === 'string') entryTargets.push(target.default)
  }
  for (const target of entryTargets) {
    if (!/\.(js|mjs)$/.test(target)) fail(`${where}：入口 ${target} 非 .js/.mjs`)
  }
}

const plugins = Array.isArray(rawIndex.plugins) ? rawIndex.plugins : []
for (const entry of plugins) {
  if (!entry || typeof entry !== 'object') continue
  const versions = Array.isArray(entry.versions) ? entry.versions : []
  if (versions.length === 0) continue // 上游已红（versions 必须非空），此处不重复报
  const newest = [...versions].sort((a, b) => semver.rcompare(a.version, b.version))[0]
  if (newest?.source?.type === 'git') {
    const dir = newest.source.path ?? entry.repository?.directory
    if (typeof dir !== 'string' || dir.length === 0) {
      fail(`插件 ${entry.name}：git 源缺 path 且缺 repository.directory，无法定位 bundle 目录`)
      continue
    }
    if (existsSync(resolve(repoRoot, dir))) {
      for (const version of versions) {
        if (version.source?.type === 'git' && (version.source.path ?? dir)) {
          await checkBundleDir(version.source.path ?? dir, entry, version)
        }
      }
    } else if (newest.source.url !== CANONICAL_REPO_URL && newest.source.url !== `${CANONICAL_REPO_URL}.git`) {
      note(`插件 ${entry.name}：外部源 ${newest.source.url}，本仓无 ${dir}，跳过本地一致性检查（聚合源形态）`)
    } else {
      warn(`插件 ${entry.name}：本仓规范源但 bundle 目录缺失：${dir}（尚未提交？）`)
    }
  } else if (newest?.source?.type === 'npm') {
    note(`插件 ${entry.name}：npm 源，registry 安装，跳过本地目录检查`)
  }
}

// ── 报告 ──────────────────────────────────────────────────────────────────
for (const n of notes) console.log(`· ${n}`)
for (const w of warnings) console.warn(`⚠ ${w}`)
if (errors.length > 0) {
  for (const e of errors) console.error(`✗ ${e}`)
  console.error(`\n校验未通过：${errors.length} 个错误 / ${warnings.length} 个警告。`)
  process.exit(1)
}
console.log(`✓ 校验通过：索引 ${relative(repoRoot, indexPath)}（${plugins.length} 个插件，${plugins.reduce((n, p) => n + (p?.versions?.length ?? 0), 0)} 个版本）+ 仓库一致性。`)
