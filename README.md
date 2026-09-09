# 小黑盒收藏归档助手（Heybox Archive）

一个基于 NestJS + React 的全栈 Web 应用，用于批量归档你的小黑盒（Heybox）收藏夹，
并通过 AI 自动打标签 / 分类 / 摘要，以 Hoarder 风格（左侧栏 + 瀑布流）浏览。

## 功能特性

- 收藏同步：批量爬取小黑盒收藏，增量入库，保留原始数据
- 评论抓取：抓取每条收藏的全部评论（含楼中楼、配图、楼层、楼主标识）
- AI 打标：调用 OpenAI 兼容接口为每条收藏打标签、分类、生成摘要
- 图片本地归档：将封面和评论配图下载到本地，实现完全离线归档
- Hoarder 风格浏览：左侧分类 / 标签筛选 + 瀑布流卡片墙 + 搜索 + 排序
- 详情弹窗：正文、配图、AI 结果、小黑盒社区风格评论区
- 导出静态站点：一键导出为纯静态站点 zip，可部署到 GitHub Pages 或本地双击打开
- 凭证安全：Cookie 和 API Key 通过设置页保存到服务端，代码内不写死

## 环境要求

- **Node.js 18+**（建议 Node 20 / 22 LTS）
- 现代浏览器（Chrome / Edge / Firefox / Safari 最新版）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 开发模式启动

```bash
npm run dev
```

启动后终端会显示访问地址，默认：
- 前端：http://localhost:5173
- 后端 API：http://localhost:3000

端口可通过环境变量修改：
- `PORT`：后端端口（默认 3000）
- `VITE_PORT`：前端端口（默认 5173）

### 3. 生产模式启动

```bash
npm run build
npm start
```

生产构建后，前端静态资源由后端服务统一提供，只需访问后端地址即可。

## 首次使用

1. 打开应用后，先进入**设置**页
2. 填写小黑盒 Cookie（浏览器登录 xiaoheihe.cn 后复制）
3. 填写 OpenAI 兼容 API 配置（Base URL、API Key、模型名）
4. 点击「测试连接」验证凭证有效性
5. 返回首页，点击「同步收藏」开始爬取
6. 同步完成后点击「批量打标」为收藏生成 AI 标签
7. 可选：点击「下载图片到本地」归档图片、点击「抓取评论」抓取评论

## 数据目录

应用数据默认存储在以下位置：

- **数据库**：由妙搭平台托管的 PostgreSQL 数据库
- **图片文件**：由妙搭平台的文件存储服务托管

> **注意**：本项目最初为妙搭（Miaoda）平台开发，数据库和文件存储由平台提供。
> 如果你是在本地自建部署，需要自行配置 PostgreSQL 数据库和文件存储。

### 备份数据

你可以通过应用内的两种方式导出数据：

1. **导出数据 JSON**：点击侧栏「导出数据」按钮，下载完整的结构化 JSON
2. **导出静态站点**：点击侧栏「导出静态站点」按钮，下载包含全部数据、图片和浏览页面的 zip 压缩包

## 导出静态站点

点击侧栏「导出静态站点」按钮，浏览器会自动下载 `xiaoheihe-archive-site.zip`。

压缩包结构：

```
xiaoheihe-archive-site.zip
├── index.html        # 静态浏览页（原生 JS，零后端依赖）
├── data/
│   └── archive.js    # 数据文件（window.__ARCHIVE__ 全局变量）
└── media/            # 本地归档的图片
    ├── cover_xxx.jpg
    └── comment_xxx_0.jpg
```

### 本地预览

解压后，直接双击 `index.html` 即可在浏览器中打开浏览（file:// 协议可正常读取数据，无跨域问题）。

### 部署到 GitHub Pages

1. 在 GitHub 创建一个新仓库（如 `heybox-archive`）
2. 将解压后的所有文件推送到仓库的 `main` 分支
3. 进入仓库 Settings → Pages
4. Source 选择 `Deploy from a branch`，Branch 选择 `main` / `/(root)`
5. 等待几分钟后，访问 `https://<你的用户名>.github.io/heybox-archive/`

> 静态站所有资源使用相对路径，支持部署在子路径下，无需额外配置。

### 静态站功能

- 瀑布流 / 列表视图切换
- 左侧栏分类筛选 + 标签云多标签筛选
- 全文搜索（标题 / 摘要 / 正文 / 标签 / 作者 / 评论）
- 按同步时间 / 原文创建时间排序
- 详情弹窗：正文、配图、原文跳转、小黑盒风格评论区（楼中楼、楼主标识、等级、配图、点赞）
- URL hash 持久化筛选条件
- 移动端响应式适配

## 项目结构

```
├── client/              # React 前端
│   └── src/
│       ├── pages/       # 页面组件（浏览页、设置页）
│       ├── api/         # 后端 API 调用封装
│       └── components/  # 可复用组件
├── server/              # NestJS 后端
│   └── modules/
│       ├── settings/    # 设置与凭证管理
│       ├── heybox/      # 小黑盒接口、收藏爬取、评论爬取
│       ├── ai-tag/      # AI 打标服务
│       ├── archives/    # 收藏列表、筛选、搜索、详情、标签管理
│       └── static-export/ # 静态站点导出
├── shared/              # 前后端共享类型定义
└── package.json
```
## License

MIT
