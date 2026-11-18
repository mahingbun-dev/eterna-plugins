# EternaPlugins — EternaAgent 官方 dsh 插件仓库

本仓库是 [EternaAgent](https://github.com/mahingbun-dev/agent-basis) 的**官方插件仓库源**：
以 dsh 原生插件市场索引（format 1）发布自包含插件 bundle，供产品的「发现」页添加索引源后
按需选择性安装。

- 索引：[`market/index.json`](market/index.json)（dsh format 1，校验规则与宿主
  plugin-market 服务零漂移）
- 插件包：[`bundles/`](bundles/README.md)（一插件一目录，目录内容即发布形态）
- 起步模板：[`template/`](template/)（宿主工具插件最小骨架）
- 发布配方：[`docs/PUBLISHING.md`](docs/PUBLISHING.md)（六步全流程）

## 如何接入 EternaAgent（管理员）

### 前置：启用「发现」页（一次性）

EternaAgent 的 eterna-web profile 默认**不含**上游「发现」tab；需管理员在 profile 里启用实验 bundle：

```bash
cd $DSH_HOME/profiles/eterna-web
pnpm add @deepseek-ai/dsh-experimental-plugin-market-bundle@0.2.2-rc.1
# package.json 的 dsh.profile.bundles 追加该包名 → 重启宿主
```

（已实测：dsh 0.2.2-rc.1 + Node 24 + pnpm 11.7，2026-11-19。「已安装」页与安装器服务本就随 dsh-base/web-app 装载，无需额外操作。）

### 添加索引源并安装

1. 打开 Web → 侧栏「**插件**」→「**发现**」标签；
2. 首次使用点「**添加索引源**」，填入本仓库索引 URL：
   `https://raw.githubusercontent.com/mahingbun-dev/eterna-plugins/main/market/index.json`
3. 搜索/按标签筛选 → 卡片点「**安装**」→ 确认对话框（版本、来源 spec、registry）；
4. 装完到「**已安装**」标签启用/停用；启用行写 profile 补丁，重启后生效。

安装通道 = 上游 dsh `plugin-market`（索引浏览）+ `plugin-manager`（pnpm/git 安装器）。
agent 会话内的 `plugin_manager`/`plugin_market` 工具链在企业部署中按 2026-11-09
三方准入红线维持禁用——插件准入只走本仓库 + 管理员 Web 面，不开放 agent 自装。

> ✅ **市场面 admin-only（T6.1，2026-11-19 已在 agent-basis 实现）**：插件市场的
> 安装/卸载/启停/索引源写入与 detail-file 路由仅 `admin` 角色可调用（普通用户/审批人
> 403；无登录会话 401）；非 admin 的「插件」页整页不渲染。实现 = access 在
> `connection.admit`（全部 `/api` 请求必经点）对市场四前缀收口，双账号无头 E2E
> 17/17 断言实证（详见 agent-basis `docs/PLUGIN-AUTHORING.md` §7）。
> **版本注意**：该门随 agent-basis 下一版本发布生效——早于该版本的部署仍是旧行为
> （单租户/受信环境可用；多租户请升级后再启用发现页）。

**内网部署**：容器不出外网时，索引源可指向内网 http 服务（静态托管本仓 `market/`），
插件安装的 git 源走内网 git 镜像；`scripts/validate.mjs` 对外部源条目自动跳过本地
目录检查（聚合源形态）。

## 仓库约束（发布前必读）

- **零内核改动**：插件能力只走官方缝（`ctx.tools` / `ctx.slots` / `ctx.approval` /
  events），禁宿主私有 API；
- **多租户铁律**（packctl tenant-scan 同款口径）：持久化只在 DSH_HOME 语义下；
  路由面独占 eterna-access（插件禁 `webServer.register*` / `connection.rpc.handle`）；
- **bundle 纪律**：只发 `.js/.mjs`（Node 24 type-stripping 拒 .ts under
  node_modules）；`@deepseek-ai/*` 一律 peerDependencies；依赖规格必须是 registry
  范围（pnpm 11 blockExoticSubdeps 拒 exotic 子依赖）；装载行必须 `- insert:`
  （裸 id 行只覆写既有行，基础树无此 id 时整行丢弃）；
- **默认导出实例**：dsh bundle loader 取模块默认导出的插件**实例**而非工厂，缺失
  = 静默不装载。

完整清单由 `node scripts/validate.mjs` 强制（CI 同款），规则源自
`@deepseek-ai/dsh-plugin-market-index`（上游格式 1 校验器）+ 仓库一致性检查。

## 目录结构

```
eterna-plugins/
├── market/index.json          # format 1 索引（plugins: [] 起步，逐个上架）
├── bundles/<name>/            # 插件包（发布形态，自包含）
├── template/                  # 新插件起步骨架（复制到 bundles/ 后改名）
├── sources/<name>/            # （可选）TS 源码工作目录，经 build-bundle.mjs 编译入 bundles/
├── scripts/validate.mjs       # 索引 + 仓库一致性校验（CI 核心）
├── scripts/build-bundle.mjs   # TS 源码 → bundle 构建配方（类型擦除为 .js）
└── .github/workflows/ci.yml   # push/PR 全量校验
```

## CI

push / PR 自动跑 `node scripts/validate.mjs`：索引走上游 `parseMarketIndex`
（devDependency `@deepseek-ai/dsh-plugin-market-index@0.2.2-rc.1`，与产品运行时
dsh 0.2.2-rc.1 同版），逐条目做 bundle 目录、补丁行、依赖纪律、客户端工件检查。
