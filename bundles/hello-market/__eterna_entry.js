// 由 EternaAgent submit_plugin_to_market 生成:bundle loader 取默认导出实例。
import * as mod from './index.js'
const raw = mod.default ?? (typeof mod.apply === 'function' ? { apply: mod.apply } : undefined)
if (raw === undefined) throw new Error('入口缺少 default 导出与 apply 导出(两形态皆无 = 无法装载)')
const base = typeof raw === 'function' ? { apply: raw } : raw
const injectKeys = Object.keys(base.inject ?? {}).filter((k) => k !== 'tools')
if (injectKeys.length > 0) throw new Error('inject 含一键发布不支持的注入面(' + injectKeys.join(', ') + '):UI/服务型插件请按 docs/PUBLISHING.md 手工发布')
export default { ...base, name: base.name ?? 'eterna-hello-market', inject: { ...(base.inject ?? {}), tools: true } }
