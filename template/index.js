// EternaAgent 宿主插件 bundle 最小骨架（形状对齐 agent-basis market/glue-bundle 先例）。
//
// ⚠️ dsh bundle loader 取模块的**默认导出插件实例**，不是工厂——缺 default 导出
// = 静默不装载（pluginInventory 有行、apply 永不执行）。见 docs/PUBLISHING.md 步骤 1。
//
// 零内核改动铁律：能力只走官方缝（ctx.tools / ctx.slots / ctx.approval / events）。
// 多租户约束（packctl tenant-scan 同款口径，发布前自查）：
// - 持久化一律在 DSH_HOME 语义下（禁硬编码 /data/... 与 os.tmpdir()）；
// - 禁 webServer.register* / connection.fetch.register / connection.rpc.handle
//   （路由面独占 eterna-access，纯展示走 /access/* 面）；
// - UI 半边（settings.section 等 slot）需 dsh.client 声明 + build:client 工件，
//   见 docs/PUBLISHING.md 步骤 1 的客户端半边小节。

const PLUGIN_NAME = 'eterna-example'

const example = {
  name: PLUGIN_NAME,
  // cordis 服务注入（对象形态，值 false = 可缺席不阻塞装载）：
  // 注册工具需要 tools 服务；需要系统提示词参与时加 systemPrompt: true。
  inject: { tools: true },
  apply(ctx) {
    ctx.tools.register({
      // 装载后实际工具名；须匹配 ^[\w][\w.-]{0,63}$
      name: 'example_hello',
      description: 'Say hello to someone.',
      parameters: {
        who: { type: 'string', required: true, description: 'Who to greet.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      execute(args) {
        return `Hello, ${args.who}! (from ${PLUGIN_NAME})`
      },
    })
  },
}

export default example
export { example }
