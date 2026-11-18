# bundles/ — 插件包目录

一插件一目录，**目录内容即发布形态**（自包含：清单 + 补丁 + .js 源，无构建中间物）。
安装时 plugin-manager 以 git+https 钉 commit 整包拉取本目录，故本目录约束最严：

- 禁发 `.ts/.mts/.cts`（`*.d.ts` 豁免）——Node 24 type-stripping 拒 .ts under
  node_modules；TS 源码经 `scripts/build-bundle.mjs` 编译后入库；
- `package.json` 必须声明 `dsh.bundle.patch` 且补丁文件存在；新增装载行用
  `- insert:`（裸 id 行只覆写既有行，基础树无此 id 时被整行丢弃）；
- `@deepseek-ai/*` 一律 peerDependencies；所有依赖规格必须是 registry 范围
  （pnpm 11 blockExoticSubdeps 拒 git/file/link/workspace 子依赖）；
- 目录名建议与 package.json name 的 unscope 部分一致（如 `@eterna/example`
  → `bundles/example/`）。

起步模板见 `../template/`；发布全流程见 `../docs/PUBLISHING.md`。
