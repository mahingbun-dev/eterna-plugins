# 发布配方：把一个插件发布到 EternaPlugins

从零到「发现」页可安装的完整流程。六步；每步都有校验兜底，出错会显式红而不是静默。

## 步骤 0：平台内一键发布（推荐，2026-11-19 起）

如果插件是在 EternaAgent 创造模式里开发的**工具型个人插件**（`install_personal_plugin` 安装过、纯 JS 入口），发布整条流水线已经内置在产品里——在会话里让 agent 调用 `submit_plugin_to_market`：

- 自动完成本配方步骤 1-5 的全部机械工作：bundle 化改写（清单重写 / wrapper 入口 / `insert` 补丁行 / `engines.dsh` 兼容声明）→ 仓库分支两段 commit（bundle + 索引，索引钉 bundle SHA）→ `scripts/validate.mjs` 零漂移校验 → push 分支 → 开 PR；
- 你只做一件事：**合并 PR**（main 有分支保护，CI validate 绿才能合）；
- 版本缺省自动递增（首发 0.1.0）；`push=false` 可先停在本地分支自查。

范围边界（如实登记）：仅工具型插件（声明 `dsh.client` 的 UI 型拒发）；目录含 `.ts` 源拒发（个人层契约本就要求纯 JS）。实现见 agent-basis `packages/access/src/market-publish.ts`。

手工六步（下方）保留为等效路径——UI 型插件、非 EternaAgent 环境开发的插件走这里。

## 步骤 1：以 `template/` 为骨架开发插件

```bash
cp -R template/ bundles/example/     # 或 TS 源码开发流：cp -R template/ sources/example/
```

改名清单三处：`package.json` 的 `name`（建议 `@eterna/<name>`）、`version`、
`cordis.patch.yml` 的行 id（建议 `eterna-<name>`，全局唯一）。

**宿主半边硬规则**：

- 模块**默认导出插件实例**（`{ name, inject, apply(ctx) }`），不是工厂——dsh bundle
  loader 取实例，缺 default 导出 = 静默不装载（`pluginInventory` 有行、apply 永不
  执行）；
- `inject` 为对象形态（cordis 服务注入，`false` = 可缺席），注册工具需
  `inject: { tools: true }` 后用 `ctx.tools.register({...})`；
- 工具参数/输出契约参考 `template/index.js`（`parameters` / `output.schema` /
  `output.render` / `execute`），工具名匹配 `^[\w][\w.-]{0,63}$`。

**客户端半边（可选，UI 类插件才需要）**：

- 清单声明 `"dsh": { "client": { "inject": [...], "platform": "web" } }` +
  `exports["./client"]`；
- 产物 `lib/client.js` 是 `window.__ModuleLoader__.load({ id, factory })` **闭包工厂
  工件**（CJS 体 + 外部化基线模块表），不是逐文件类型擦除能产出的——构建配方参考
  agent-basis `packages/*/scripts/build-client.mjs`（esbuild banner/footer 模式），
  `scripts/build-bundle.mjs` 不生成它；
- UI 一律走官方 slot（`settings.section` / `plugins.tab` 等），禁独立页面；应用内
  渲染统一 `--et-*` 令牌（先例：agent-basis `packages/access/src/client/`）；
- `validate.mjs` 会检查 `dsh.client.inject` 非空 + `exports['./client']` 目标文件
  存在（工件没入库直接红）。

## 步骤 2：自包含化——bundles/ 内只发 .js

Node 24 type-stripping **拒绝执行 node_modules 下的 .ts**，因此 bundle 目录内容即
发布形态、只含 `.js/.mjs`。TS 源码开发流：

```bash
# sources/example/ 内写 TS（相对导入必须带 .js 扩展名的 ESM 形态）
node scripts/build-bundle.mjs sources/example bundles/example
```

构建 = 逐文件类型擦除（esbuild transform，不做整包打包）+ 资产拷贝 + 清单裁剪
（去 devDependencies / build* scripts）。依赖纪律随构建一起锁死：

- `@deepseek-ai/*`（dsh/cordis 包）一律 **peerDependencies**——运行时由宿主两锚点
  解析提供，dependencies 双装即版本漂移；
- 所有依赖规格必须是 **registry 范围**——pnpm 11 `blockExoticSubdeps` 拒绝
  git/file/link/workspace 子依赖；对本仓外的 git 依赖走索引 `source` 钉 commit
  安装，不走包内依赖。

## 步骤 3：提交 bundle，取 commit SHA

```bash
git add bundles/example && git commit -m "feat(example): <一句话>"
git rev-parse HEAD                  # 40-hex commit SHA
```

一个 commit 可以包含多个插件目录；索引条目按 commit 钉版，同 commit 多条目共享
`publishTimestamp` 亦可。

## 步骤 4：写索引条目（format 1）

在 `market/index.json` 的 `plugins[]` 追加（字段校验走上游 `parseMarketIndex`）：

```jsonc
{
  "name": "@eterna/example",                    // npm 包名形态，索引内唯一
  "title": { "en": "Example", "zh": "示例插件" },
  "description": { "en": "...", "zh": "..." },  // 详情页还会回读 README
  "homepage": "https://github.com/mahingbun-dev/eterna-plugins",
  "repository": { "url": "https://github.com/mahingbun-dev/eterna-plugins",
                  "directory": "bundles/example" },
  "metadata": { "category": "tool", "keywords": ["example"] },  // category 须在 metadata.categories 声明
  "versions": [{
    "version": "0.1.0",                          // 精确 SemVer，同条目内唯一
    "publishTimestamp": 1763400000,              // Unix 秒整数
    "source": { "type": "git",
                "url": "https://github.com/mahingbun-dev/eterna-plugins",
                "commit": "<40-hex>",            // 步骤 3 的 SHA
                "path": "bundles/example" }
  }]
}
```

版本纪律：`version` 精确 SemVer 且同条目内唯一；`commit` 必须 40 位小写 hex；
升版本 = bundle 改版提交新 commit → 追加新 versions 条目（解析器自动按 SemVer
降序取最新，旧版本保留可装）。

## 步骤 5：全量校验后 push

```bash
pnpm install            # 首次 / devDeps 变更后
node scripts/validate.mjs
```

绿 = 上游格式 1 通过 + 仓库一致性通过（bundle 目录存在、清单 name/version 对齐
索引、补丁 insert 行带 id、无 .ts、依赖纪律、客户端工件存在）。CI（GitHub
Actions）在 push/PR 重跑同款校验——本地绿 CI 即绿。

## 步骤 6：在 EternaAgent 里验收

1. 管理员打开 插件 → 发现 → 添加索引源
   `https://raw.githubusercontent.com/mahingbun-dev/eterna-plugins/main/market/index.json`
   （已添加过则点「插件索引」菜单刷新）；
2. 找到新卡片 → 安装 → 确认对话框（显示钉版 commit 与来源 spec）→ 安装检查；
3. 已安装标签启用 → 重启宿主生效（eterna-web profile 无 HMR）；
4. 验收口径：日志 grep `skipping|incompatible` 为 0（agent-basis
   PLUGIN-AUTHORING §4 同款）；agent 会话内工具确实出现（宿主半边）或设置分区
   确实渲染（客户端半边）。

## 附：内网镜像与聚合源

- **内网部署**：索引 JSON 可静态托管在内网 http 服务（`market/` 目录整体拷贝），
  安装源 `source.url` 指向内网 git 镜像——两处 URL 都须对容器可达；
- **聚合源形态**：`source.url` 指向外部仓库时，`validate.mjs` 跳过本地目录检查
  （仅校验索引格式），仓库自身不承载该 bundle。
