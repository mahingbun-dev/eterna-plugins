/** 示例工具型个人插件:证明「创造模式开发 → 一键发布 → 市场安装」全链路。 */
export function apply(ctx) {
  ctx.tools.register({
    name: 'hello_market_ping',
    description: '返回一条带时间戳的问候(示例插件 hello-market)',
    parameters: {
      text: { type: 'string', description: '想说的话(缺省 world)' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    async execute(args) {
      const text = typeof args.text === 'string' ? args.text : 'world'
      return `hello, ${text}! (hello-market 0.1.0 @ ${new Date().toISOString()})`
    },
  })
}
