# Package/Common 包规则

- 按实际复用需求新增通用模块，并通过 `@workspace/common/<module>` 的独立子入口消费；不开放包根，不用深层源路径或别名绕过 `exports`。
- 通用模块保持平台无关，不读取环境变量，也不在导入时执行 I/O 等副作用；HTTP DTO 与请求管线留在 `packages/sdk/`，UI 留在 `packages/components/`。
- 仅供 Node 使用的模块放在 `packages/common/src/node/`，公开入口位于 `@workspace/common/node/<module>`，并在 `exports` 的 `browser` 条件下拒绝；当前身份配置入口为 `@workspace/common/node/identity-config`。
- 新增入口时测试 Node 解析、未公开路径拒绝和实际浏览器打包边界。
