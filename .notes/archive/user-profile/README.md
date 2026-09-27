# 用户资料与社区身份组

本目录记录两项相关但可分别实施的设计：

1. [用户基础资料设计](specs/2026-09-23-user-profile-design.md)及其 [RFC](rfcs/user-profile-snapshot-and-edit-rfc.md)：用户名、QQ、头像、FiveM ID，以及登录用户读取本人 snapshot 和设置本人资料的 API 能力。
2. [通用社区身份组设计](specs/2026-09-23-default-community-group-design.md)及其 [RFC](rfcs/default-community-group-rfc.md)：后续增加的默认社区组需求，只涉及 `general` 组和成员关系。

两项均为设计文档；目前的 HTTP Contract、数据库和网页尚未实现这些新增资料或社区组。
