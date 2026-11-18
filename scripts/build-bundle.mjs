#!/usr/bin/env node
// TS 源码 → 自包含 bundle 的构建配方（把源码目录编译/整理成 bundles/<name>/ 的
// 最终形态：只含 .js/.mjs + 清单 + 补丁，TS 不入库——Node 24 type-stripping
// 拒 .ts under node_modules）。
//
// 约束（沿用 agent-basis T21 教训，见 docs/PUBLISHING.md 步骤 2）：
// - 只做逐文件类型擦除（transform），不做整包打包：相对导入必须写成带 .js 扩展
//   的 ESM 形态（import './x.js'），与 dsh 两锚点解析共存；
// - dsh/cordis 包一律 peerDependencies（运行时由宿主提供），绝不出现在源码
//   dependencies（pnpm 11 blockExoticSubdeps 拒 exotic 子依赖）；
// - 客户端半边（dsh.client）产物 lib/client.js 是 window.__ModuleLoader__ 闭包
//   工厂工件，非逐文件擦除能产出——见 docs/PUBLISHING.md 步骤 1 客户端小节
//   （配方参考 agent-basis packages/*/scripts/build-client.mjs 的 esbuild
//   banner/footer 模式），本脚本不生成它，由 validate.mjs 检查其存在。
//
// 用法：node scripts/build-bundle.mjs <source-dir> <bundle-dir>
//   例：node scripts/build-bundle.mjs workbench/example bundles/example
// 退出码：0 成功；1 失败。

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [srcArg, outArg] = process.argv.slice(2)
if (!srcArg || !outArg) {
  console.error('用法：node scripts/build-bundle.mjs <source-dir> <bundle-dir>')
  process.exit(1)
}
const srcDir = resolve(srcArg)
const outDir = resolve(repoRoot, outArg)
if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
  console.error(`✗ 源码目录不存在：${srcDir}`)
  process.exit(1)
}
if (outDir.startsWith(srcDir)) {
  console.error('✗ 输出目录不能在源码目录内部')
  process.exit(1)
}

let esbuild
try {
  esbuild = (await import('esbuild')).default ?? (await import('esbuild'))
} catch (error) {
  console.error('✗ 缺依赖 esbuild（devDependencies）。请先 `pnpm install`。')
  console.error(`  原始错误：${error?.message ?? error}`)
  process.exit(1)
}

const errors = []
const SRC_EXT = /\.(ts|mts|cts)$/
const ASSET_SKIP = new Set(['node_modules', '.git', '.DS_Store'])

// 1) 清空输出目录（防旧 .ts 残留）
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// 2) 逐文件：TS → 类型擦除为 .js；其余资产原样拷贝（package.json 除外）
const walk = (current, prefix) => {
  for (const name of readdirSync(current)) {
    if (ASSET_SKIP.has(name)) continue
    const from = join(current, name)
    const rel = prefix ? `${prefix}/${name}` : name
    if (statSync(from).isDirectory()) {
      walk(from, rel)
      continue
    }
    if (SRC_EXT.test(name)) {
      const source = readFileSync(from, 'utf8')
      try {
        const result = esbuild.transformSync(source, {
          loader: name.endsWith('.mts') ? 'mts' : name.endsWith('.cts') ? 'cts' : 'ts',
          format: 'esm',
          target: 'node24',
          sourcefile: from,
        })
        const outRel = rel.replace(SRC_EXT, (m) => ({ '.mts': '.mjs', '.cts': '.cjs', '.ts': '.js' })[m])
        writeFileSync(join(outDir, outRel), result.code)
      } catch (error) {
        errors.push(`${rel}：编译失败：${error.message}`)
      }
      continue
    }
    if (name === 'package.json') continue // 清单统一走步骤 3
    cpSync(from, join(outDir, rel))
  }
}
walk(srcDir, '')

// 3) 清单：源 package.json 为底，去掉 dev 层（devDependencies / scripts.build* / private 保留），
//    并把入口路径的 TS 扩展名改写成编译产物扩展名（否则 bundle 加载会去找 .ts——
//    Node type-stripping 在 node_modules 下拒执行，装载必失败；validate.mjs 同样会红）。
const retarget = (target) =>
  typeof target === 'string'
    ? target.replace(/\.(mts|cts|ts)$/, (_, ext) => ({ mts: '.mjs', cts: '.cjs', ts: '.js' })[ext])
    : target
if (!existsSync(join(srcDir, 'package.json'))) {
  errors.push('源码目录缺 package.json')
} else {
  const manifest = JSON.parse(readFileSync(join(srcDir, 'package.json'), 'utf8'))
  delete manifest.devDependencies
  for (const key of Object.keys(manifest.scripts ?? {})) {
    if (key.startsWith('build')) delete manifest.scripts[key]
  }
  if (typeof manifest.main === 'string') manifest.main = retarget(manifest.main)
  if (manifest.exports !== null && typeof manifest.exports === 'object' && !Array.isArray(manifest.exports)) {
    for (const [key, value] of Object.entries(manifest.exports)) {
      if (typeof value === 'string') manifest.exports[key] = retarget(value)
      else if (value !== null && typeof value === 'object') {
        for (const [condition, target] of Object.entries(value)) {
          if (typeof target === 'string' && target !== key) value[condition] = retarget(target)
        }
      }
    }
  }
  writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

// 4) 报告
if (errors.length > 0) {
  for (const e of errors) console.error(`✗ ${e}`)
  console.error('\n构建未完成，输出目录已写入部分产物（校正后重跑覆盖）。')
  process.exit(1)
}
console.log(`✓ 已构建 ${relative(repoRoot, outDir)}（源：${basename(srcDir)}）。`)
console.log('  下一步：')

console.log('  1. 按 docs/PUBLISHING.md 步骤 3-4 提交 bundle → 取 commit SHA → 写 market/index.json 条目；')
console.log('  2. node scripts/validate.mjs 全绿后 push。')
