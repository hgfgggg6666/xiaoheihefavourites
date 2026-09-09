# 小黑盒收藏归档应用（Heybox Archive）

## 概览

一个「小黑盒收藏夹本地归档 + AI 打标签 + Hoarder 风格浏览」的全栈网页应用。

- 后端批量爬取小黑盒账号收藏，本地持久化归档
- 调用 OpenAI 兼容接口对收藏自动打标签 / 分类 / 摘要
- Hoarder（karakeep）风格前端浏览：左侧分类 / 标签筛选，右侧瀑布流卡片墙

## 技术架构

### 后端模块

| 模块 | 目录 | 职责 |
|------|------|------|
| settings | server/modules/settings | 凭证配置（Cookie / OpenAI）保存与测试 |
| heybox | server/modules/heybox | 小黑盒签名算法、收藏爬取、增量同步、进度管理 |
| ai-tag | server/modules/ai-tag | AI 打标（OpenAI 兼容）、批量打标、进度管理 |
| archives | server/modules/archives | 收藏列表 / 筛选 / 搜索 / 详情、标签编辑、图片归档、导出 |

### 前端页面

| 页面 | 路径 | 组件 |
|------|------|------|
| 浏览页（首页） | / | BrowsePage — 侧边栏 + 瀑布流 |
| 设置页 | /settings | SettingsPage — Cookie + OpenAI 配置 |

## 数据库表

- `archive_settings` — 配置（Cookie、OpenAI 端点、API Key、模型）
- `archive_item` — 收藏条目（linkid、原始 JSON、AI 标签 / 分类 / 摘要、本地图片路径）
- `archive_tag` — 标签（名称、颜色）
- `archive_item_tag` — 条目-标签多对多关联
- `sync_job` — 同步任务进度（爬取 / 打标）

## 设计规范

### 视觉风格
- Hoarder / karakeep 风格：浅色背景、卡片式瀑布流、左侧固定侧栏
- 主色调：深灰蓝作为主色（primary），用于侧栏选中态与交互强调
- 整体简洁、信息密度适中、卡片有轻微阴影与 hover 提升

### 间距
- 页面级 padding：20px
- 卡片间距：gap-4 (16px)
- 侧栏宽度：260px

### 字体
- 标题：font-semibold text-base
- 正文：text-sm
- 辅助文字：text-xs text-muted-foreground

### 卡片
- 圆角：rounded-lg
- 阴影：shadow-sm hover:shadow-md transition-shadow
- 边框：border border-border/50
