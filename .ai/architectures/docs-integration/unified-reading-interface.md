# 文档阅读界面的呈现与数据边界

公共阅读与成员工作区共用 Outline 的布局、导航和正文呈现。共用组件不提供身份或授权；公共页面仍由当前公开可见性决定内容，成员页面仍由原工作区 policy 决定能力。

_最后更新：2026-10-09_

## 共用呈现

| 边界 | 实现与职责 |
| --- | --- |
| 页面框架 | `apps/outline/app/components/DocsLayout.tsx` 接收侧栏和内容插槽，集中拥有右侧栏、Portal 及可选 DocumentContext provider；不要求 User 或 Team。 |
| 导航 | `apps/outline/app/components/Sidebar/DocsNavigation.tsx` 接收只包含标签、地址、子节点和选中/展开状态的投影。集合展开按钮与链接分开；成员个人功能通过受保护插槽提供。 |
| 正文 | `apps/outline/app/scenes/Document/components/DocumentReadingFrame.tsx` 共用标题、正文宽度与目录位置。公共目录只接收 headings 和导航回调，不构造成员 Document。 |
| 搜索 | `apps/outline/app/components/DocsSearch.tsx` 共用成员搜索的胶囊输入、筛选行、页面间距、无结果提示和结果呈现；两种页面使用同一个 Scene，成员与公共 adapter 分别处理自己的 DTO 和查询。公共文档集筛选只投影 PublicDocsStore 数据，不挂成员筛选或 Model；已就绪搜索页独自拥有 Header，公共外层在配置等待或失败时提供 Header。 |
| 状态 | `apps/outline/app/components/DocsStatus.tsx` 共用轻量线性图标和提示。加载只显示旋转图标与单行文案，并遵守减少动态效果设置；`not-found` 使用 FileSearch、说明与唯一返回主页链接，网络或服务失败保留真实 Retry callback；空状态使用 Files 图标。`layout` 显式区分 `inline` 局部内容、`page` 顶部栏下方居中和 `fullscreen` 无顶部栏的全高居中，侧栏与评论不得使用整页高度。 |

`AuthenticatedLayout` 保留原用户/团队 hook、拖拽、快捷键、通知与个人工作区行为。`WebsitePublic` 不挂载这些身份专属组件。集成公共路由在 `apps/outline/app/routes/index.tsx` 登记，独立 Outline 的登录与共享路由仍保留原分支。

成员侧栏的 `apps/outline/app/components/Sidebar/components/SidebarLink.tsx` 将行内操作与链接导航隔离：操作区先让子按钮处理事件，再阻止冒泡并取消 click 默认行为。仅阻止冒泡不能阻止外层 anchor 的原生导航；mousedown 与键盘事件也须隔离，避免触发 NavLink 的提前导航。`ellipsis={false}` 同时解除标签与行容器裁切，供新建子文档和重命名输入框保留完整焦点描边；普通文本行继续裁切长标题。

成员文档顶栏在 `apps/outline/app/scenes/Document/components/Header.tsx` 将左侧面包屑、目录与收藏，以及右侧文档操作分别放入半圆角 Glass 胶囊；协作者头像保留在操作胶囊外。材质沿用 Outline 的 styled-components 适配层和 ExUI Glass tokens，普通操作默认透明，保存与发布保留原主操作语义。菜单继续通过既有 Portal 呈现，权限与紧凑布局条件仍由原成员组件控制；此样式不扩展公共阅读能力。

文档页与文档集页共用 `apps/outline/app/components/GlassToolbar.tsx` 的材质和紧凑尺寸。文档集在 `apps/outline/app/scenes/Collection/index.tsx` 包裹左侧搜索或归档面包屑，在 `apps/outline/app/scenes/Collection/components/Actions.tsx` 包裹右侧操作，成员头像仍在胶囊外；新建与编辑使用透明按钮，完成编辑保留主操作样式。链接式操作须显式保留 `data-slot="action-button"`，使尺寸约束与原生按钮一致。

胶囊内的 32px 操作按钮须同步解除 `Button.Inner` 默认 36px 的最小高度，否则文字与图标会向下溢出。`exui.glass.shadow` 提供内描边，外投影另由 `exui.shadow.medium` 叠加；不能将内描边当作面板投影。真实浏览器回归入口为 `tests/browser/docs-toolbar-geometry.mjs`，检查内容居中和外阴影；文档集页传入 `data-collection-toolbar` 属性名。

侧栏折叠后，`apps/outline/app/components/Header.tsx` 的桌面展开控件同样复用 `GlassToolbar`：40px 外层承载材质与阴影，32px 按钮只负责交互，外部槽位预留与相邻胶囊的间距并在展开侧栏后收起。不要改用普通 36px ToggleButton 或复制另一份 Glass 高光。`tests/browser/docs-toolbar-geometry.mjs` 的 `assertDocsHeaderToggleGlass` 比较可见 Header 控件与工具栏的高度、顶边和材质，须排除折叠侧栏中的 inert/隐藏按钮。

恢复阅读与集成退出的等待/失败使用 `apps/outline/app/components/DocsRecoveryLayout.tsx`，组合同一个 DocsLayout、Header 和公共导航；它不挂账号菜单或成员通知。状态保留品牌和侧栏，不另建裸页面。Website 退出确认使用自己的 ExUI 体系提供等价的图标、标题、说明和重试；不跨仓库复用 React 组件。

`apps/outline/app/components/DocsNavigationFocus.tsx` 在每个共用布局内协调集成模式的主区域焦点。首次进入页面及身份核验不主动聚焦标题；布局内 pathname 变化后才等待可见标题/状态，使用 `data-docs-focus` 与 `data-docs-state` 区分正文就绪和加载转换。侧栏与隐藏/inert 内容不是目标；普通重渲染、query/hash、分页和输入交互不重新夺取焦点。独立模式保留原焦点行为。

公共正文的返回集合与目录入口由 `apps/outline/app/scenes/WebsitePublic/PublicReadingNavigation.tsx` 组合既有 GlassNavigationToolbar 和 Button，放在 Header.left。`DocumentReadingFrame` 只负责标题、有效的公开更新时间、正文与目录展示；导航不进入正文列。`WebsitePublic` 仅在配置等待、失败或未初始化时拥有 Header；就绪集合由 PublicDirectory 的 Scene、文档由互斥的 PublicDocumentView/Reader 分支拥有 Header，publicOnly 使用相同分支。

`PublicDocument` 持有本地目录偏好、headings 与 Drawer 状态，不读写成员 DocumentPreference。headings 保留 Editor ref/onInit 双时机初始化及等值比较，排除表格内标题，仅呈现 level <= 4。移动模式或共用阅读网格右侧空间不足现有目录宽度时，顶部入口打开既有 Drawer；空间足够时切换侧栏目录，正文列不移动。尺寸切换、路由与身份代次变化清理抽屉；选择标题保留 location state，仅更新 hash 并关闭抽屉。打印使用独立静态目录，并隐藏公共抽屉 Portal 和遮罩。成员目录仍使用原偏好和能力边界。

公共 Sidebar 直接复用 SidebarLink、Disclosure 与分组 Header。展开按钮和锚点为兄弟节点；集合直属文档最小深度为 2，后续逐级递增。PublicNavigation 在 observer 内复制 expandedIds，使仅改变文档展开状态也会更新不依赖 MobX 的展示行。文档当前页只高亮文档，所属集合保持展开；空公共插槽不增加分组标题。公共集合页使用 Scene 和 DocsSearchResult 展示组件，完整描述经只读 publicReader Editor 渲染，根文档列表保留公开树语义；移动列表宽度修正限制在公共适配器。

公共目录与搜索结果的文件夹、文件图标共用 `apps/outline/app/components/DocsSearch.tsx` 的 `DocsSearchResultIcon`。图标容器与标题第一行使用同一行高并在容器内居中，摘要不参与图标垂直定位；直接将 16px 图标贴在标题行顶部会产生约 2.8px 的中心偏差。SidebarLink 已按标签行居中，目录修正不向侧栏增加补偿位移。

## 公共数据生命周期

`apps/outline/app/stores/PublicDocsStore.ts` 管理临时公共 DTO。它不继承成员 Model/Store，不写成员实体或 IndexedDB。`RootStore` 在身份、团队、collaboration token、已核验会话代次或集成身份可用性变化时同步使公共状态失效；迟到响应必须通过 generation 和相应请求 epoch 检查才能写回。

公共 adapter 只调用既有四个 Outline RPC：`public.collections.list`、`public.documents.list`、`public.documents.info`、`public.documents.search`。Store 使用既有 Client 的 `fetch` POST，并自己管理 in-flight promise；这避免外层 `post` 去重把旧身份的同参数在途响应交给新一代读取。Website 不接管这些 API，也不增加第二份 HTTP Contract。

集合目录逐页加载；页面挂载只确保首次目录读取，不因切页自动加载下一页。展开某个集合才加载它的文档分页，全部页面收集后构建树。同一身份 generation 内复用已加载的目录页和已完成的集合树，进入集合页或文档页不强制重拉，也不将缓存树改回加载状态；目标集合不在已加载页时继续按需分页查找。排序以公开 title/name 和 id 为准，缺失父节点与环回退为根节点。分页声明还有下一页却没有取得新条目时显示可重试失败，不能持续请求或把不完整树当作完成。

目录缓存仅在当前浏览器页面的 Store 内存中存在，不设置定时轮询或持久缓存。刷新网页、身份失效或对应资源的显式重试会重新读取；集合页错误重试显式重建目录并刷新目标树。公开目录或标题更新通常在刷新网页后可见。正文每次进入仍调用 `public.documents.info` 检查当前内容和可见性，强制正文重验证仍刷新所属树；缓存目录不授予正文访问权。

直达文档先读取当前正文所属集合，再逐页定位公开集合并加载该树，展开可见祖先。正文与导航共享读取状态；用户收起节点或离开路由时取消对应投影。取消尚在加载的树时同时收起节点，下一次展开启动新读取；已经完成的树可保留。强制重验证绕过同文档在途去重，立即隐藏旧正文。确认不可见后清理导航、搜索和正文投影，不能通过旧树保留标题；此清理不改变当前文档的身份 generation，以免 404 自动重读循环。

## 公共只读与成员授权

`PublicDocument` 使用原富文本 Editor 的只读 schema 和完整正文呈现。显式 `publicReader` 能力关闭成员 integration 加载、内部 mention 预取、unfurl 与编辑交互；不通过伪造 Share、User 或 Team 复用成员权限。静态 mention 保留可读文本，附件和公开深链接使用现有公开路径。

`PublicOnlyGate` 在进入成员文档前读取受保护的最小权限投影。publicOnly 读者进入公共 DTO 阅读分支，只在已核验身份且允许评论时挂载 `PublicComments`；内部访问记录、成员、引用和历史逻辑继续留在成员分支。评论读取和提交各有请求代次；失败显示安全原因与重试，撤权触发正文强制重验证。

这些客户端边界降低副请求与旧状态泄露风险，不能替代服务端权限判断。公共可见性、SSR、canonical、sitemap 和附件授权仍由 `apps/outline/server/commands/publicAccess.ts` 及既有服务端路由负责，详见 `.ai/architectures/docs-integration/integration-boundaries.md`。

## 退出与阅读恢复

Outline 的 `apps/outline/shared/utils/docsReadingReturnPath.ts` 与 Website 的 `apps/web/src/pages/IdentityPage/docsReturnPath.ts` 分别校验窄阅读路径，使用同一组测试向量。仅允许文档总览、合法公开集合、原文档 slug 和有限搜索参数；文档与搜索保留合法单值 q，collectionId 只用于搜索。未知 query/hash 被去除，动作路由与不安全编码被拒绝。这一导航提示不证明身份或公开可见性，不能替代原 OIDC 的更宽返回路径 helper。

集成退出立即设置 `AuthStore.logoutPending`，再用当前公开 RPC 预检可恢复目标；预检失联不阻塞撤销，只回退到总览。`auth.delete` 仍须返回固定成功结果和 `/identity/signed-out`，Outline 仅在验证后添加导航提示。会话代次与退出尝试保护异步清理和跳转，旧尝试不能清理后来核验的会话。

Website 的 `SignedOutPage` 保留原 token 核验和会话变化订阅。只有确认退出且跳转前 token 仍匹配时，才通过 `/docs/?docsResume=…` 继续；active 或 unavailable 不自动跳转。Outline 根 `WebsiteIdentityController` 在恢复期间抑制自动身份桥接，先通过 Router 删除提示 query，再匿名预检和 SPA replace。一次性 `docsReadingResume` marker 让最终阅读入口再次检查公开目标；不可见时清理 PublicDocsStore 的旧树、正文、搜索与在途代次，回到通用提示，不展示旧标题。该 marker 不授予权限，后续仍进入原成员授权或公共 DTO 分支。

身份错误的重试由同一 controller 区分失败阶段：配置失败重读 auth.config，身份失联重读 auth.info，Website probe 失败重新探测，显式 OIDC 失败重新发起一次显式登录并清除失败 hash。普通匿名结果不自动升级为登录；自动尝试限制和旧回调代次保护继续生效。

公共阅读正文只呈现文档状态，不叠加登录状态错误区块。`PublicNavigation` 在匿名身份不可用且配置就绪时，将带可访问名称和提示的轻量重试按钮放在侧栏登录入口旁，继续调用同一 controller 的分阶段重试；普通匿名和阅读恢复界面不显示该按钮。配置与文档读取失败仍在原内容区域提供错误和重试。

退出等待期间，policy 投影、动作执行、正文保存、评论和发布入口共同阻止新写操作。`DocumentPublish` 必须使用 projected `PoliciesStore.abilities`；原始 policy 读取会绕过等待保护。异步 move/save 后还要检查 pending 与窗口捕获的会话代次，阻止旧操作继续写入或关闭后来会话的窗口。已开始的服务端写请求不能撤回；同代次退出失败后恢复原操作能力。

## 维护入口

修改共用呈现时同时检查匿名 adapter 和真实成员消费点，避免增加要求 User/Team 的隐式依赖。修改公共读取时检查取消、重试、权限变化和迟到响应，不能只验证成功返回。独立 Outline 使用自己的 Yarn 和测试配置；测试工作流与真实浏览器、账号、OIDC 验收分别记录。
