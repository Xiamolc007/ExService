# 设置状态与 AuthContext 保持独立

- 状态：已实现
- 模块：`web`
- 日期：2026-09-24
- 来源：用户设置面板设计 `.notes/archive/backend-sandbox/user-settings/specs/2026-09-24-user-settings-panel-design.md` 与技术 RFC `.notes/archive/backend-sandbox/user-settings/rfcs/user-settings-panel-rfc.md`

_最后更新：2026-09-29_

## 背景

设置面板首版需要在 Modal 与现有 `/account/profile` 页面共用资料、主题和整块内容加载状态；后续还可能增加设置分类。当前 `AuthContext` 已负责登录态、token 生命周期、顶栏资料和退出登录，现有资料页则自行读取和更新本人资料。

## 决策

- 在 `apps/web` 使用全局 Valtio `settingsConfig` 存放设置资料的内存缓存与读取状态，并保留未来分类扩展的位置。它不接管登录态，也不替换现有 `AuthContext`。
- `AuthContext` 的职责、接口和行为保持现状。资料保存成功后，设置层以服务器返回值更新自身缓存，再调用现有 `refreshProfile()` 同步顶栏；会话失效仍使用现有 `invalidateSession()`，退出仍使用现有 `logout()`。
- 主题仍由 ExUI `ThemeProvider` 决定；`settingsConfig` 只能投影当前主题，不提供第二个持久化或写入来源。理由与现有`.ai/decisions/web/03-exui-as-component-and-theme-source.md`一致。
- 设置界面由 `packages/components` 接收值和回调展示。通用的整块内容加载、错误与重试组件也属于该共享 UI 包；API、Valtio、路由和浏览器会话访问留在 `apps/web`。
- 设置缓存仅在当前浏览器内存中存在，绑定当前会话；账号切换、退出或明确失效时清空，迟到响应不得覆盖新会话。

## 理由与取舍

全局设置对象让 Modal 和页面读到同一份设置数据与加载状态，同时给未来分类提供一致入口。继续由 `AuthContext` 管理身份和顶栏，避免设置功能改变既有认证流程。代价是设置缓存与顶栏资料短暂存在两份读取结果；保存后须调用 `refreshProfile()`，顶栏刷新失败时应保留已成功的设置结果并提示重试。

把全部设置资料并入 `AuthContext` 会扩大认证 Context 的职责；让 Modal 与页面各用局部状态则会重复请求和错误处理。两种方案均未采纳。

## 适用范围与重新审视

该边界已在 `apps/web/src/settings/` 和共享设置界面中实现；实现细节和验收路径见技术 RFC。若设置资料需要跨设备同步或拥有独立于本人资料的服务器来源，须重新评估切片来源和同步规则；不得据此把 token 或邮箱写入新的浏览器持久化存储。

## 读取生命周期约束

`SettingsExperience` 的分区读取标记只在一次 effect 挂载期间有效，清理时必须清空。React StrictMode 会执行挂载、清理、重新挂载；控制层在最后一个消费者离开时让在途读取失效，如果分区仍保留“已读取”标记，重新挂载就不会补发请求，即使 HTTP 成功也无法显示资料。清理读取标记让重新挂载发起有效请求，同时保留请求代次检查，拒绝首次读取的迟到响应。回归由 `apps/web/src/settings/SettingsProfileLoading.test.tsx` 覆盖真实设置面板、Modal 与迟到响应。
