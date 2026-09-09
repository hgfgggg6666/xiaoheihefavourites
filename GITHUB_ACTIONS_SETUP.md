# GitHub Actions 完全自动化部署

通过 GitHub Actions 实现：每天自动同步小黑盒收藏夹 → 下载图片 → 导出静态站点 → 部署到 GitHub Pages。完全不需要本地操作。

## 配置步骤

### 第一步：把代码推送到 GitHub



git init
git add .
git commit -m "Initial commit with auto-sync workflow"
git remote add origin https://github.com/你的用户名/xiaoheihe-favourites.git
git branch -M main
git push -u origin main
```

### 第二步：配置 GitHub Secrets

1. 打开你的 GitHub 仓库页面
2. 点击 **Settings**（设置）
3. 左侧菜单找到 **Secrets and variables** → **Actions**
4. 点击 **New repository secret**，依次添加以下 Secrets：

| Secret 名称 | 说明 | 示例 |
|------------|------|------|
| `HEYBOX_COOKIE` | 小黑盒登录 Cookie（必填） | `_ga=...; heybox_id=...` |
| `OPENAI_API_KEY` | OpenAI 兼容 API Key（必填） | `sk-xxxxxxxxxx` |
| `OPENAI_BASE_URL` | API Base URL（可选，默认 OpenAI） | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 模型名称（可选，默认 gpt-4o-mini） | `gpt-4o-mini` |
| `OPENAI_TEMPERATURE` | 温度参数（可选，默认 0.3） | `0.3` |

**如何获取小黑盒 Cookie：**
1. 在浏览器登录小黑盒网页版
2. 按 F12 打开开发者工具
3. 切换到 Network（网络）标签
4. 刷新页面，点击任意请求
5. 在 Request Headers 里找到 Cookie，复制完整值

### 第三步：开启 GitHub Pages

1. 仓库 Settings → **Pages**
2. **Source** 选择 **GitHub Actions**
3. 保存

### 第四步：手动触发第一次运行

1. 打开仓库页面，点击顶部 **Actions** 标签
2. 左侧选择 **Auto Sync and Deploy**
3. 点击 **Run workflow** → 选择 main 分支 → 点击 **Run workflow**
4. 等待运行完成（大概 5-10 分钟）
5. 运行完成后，在 Settings → Pages 可以看到网站地址

## 自动运行时间

Workflow 配置为**每天北京时间上午 10:00**自动运行（UTC 2:00）。

如果想修改时间，编辑 `.github/workflows/auto-sync-deploy.yml` 里的 cron 表达式：

```yaml
schedule:
  - cron: '0 2 * * *'  # UTC 时间，北京时间 = UTC + 8
```

常见时间：
- 北京时间 10:00 → `0 2 * * *`
- 北京时间 8:00 → `0 0 * * *`
- 北京时间 20:00 → `0 12 * * *`
- 每 6 小时 → `0 */6 * * *`

## 工作流程说明

每次运行会执行以下步骤：

1. **检出代码** - 从 GitHub 拉取最新代码
2. **安装依赖** - npm install
3. **构建应用** - 编译前端和后端
4. **自动同步** - 运行 `scripts/auto-sync.js`：
   - 启动 NestJS 应用
   - 保存小黑盒 Cookie 和 OpenAI 配置
   - 同步收藏夹（调用小黑盒 API）
   - 下载所有帖子图片到本地
   - 导出静态站点 zip 包
   - 解压到 `exported-site/` 目录
   - 关闭应用
5. **部署到 GitHub Pages** - 把 `exported-site/` 部署到 GitHub Pages

## 注意事项

### ⚠️ 小黑盒风控风险

GitHub Actions 的服务器 IP 可能被小黑盒识别为异常，有以下风险：
- 触发验证码
- 临时封禁 IP
- Cookie 失效

**建议：**
- 不要设置太频繁的同步（每天一次足够）
- 如果发现同步失败，可能是 Cookie 过期了，更新 Secrets 里的 HEYBOX_COOKIE
- 如果持续失败，建议改回本地同步 + 手动推送的方式

### 数据不持久化

GitHub Actions 每次运行都是全新环境，SQLite 数据库不会保存。每次都会：
- 从头同步所有收藏（168 条大概 1-2 分钟）
- 重新下载所有图片（552 张大概 3-5 分钟）
- AI 打标签不会自动运行（需要的话可以在脚本里添加）

如果收藏很多，运行时间可能较长，注意 GitHub Actions 免费账户每月 2000 分钟限额。

### AI 打标签

当前脚本**不会自动运行 AI 打标签**（因为每次都重新打标签会消耗大量 API 额度）。

如果需要自动打标签，编辑 `scripts/auto-sync.js`，在图片下载后添加：

```javascript
// AI 打标签（可选）
console.log('\n开始 AI 打标签...');
try {
  await apiPost('/api/ai-tag/start');
  await waitForJob('/api/ai-tag/status', 'AI 打标签', 1800000);
} catch (e) {
  console.log(`AI 打标签: ${e.message}`);
}
```

## 常见问题

**Q: 运行失败怎么办？**
A: 在 Actions 页面点击失败的运行，查看日志，根据错误信息排查。常见原因：
- Cookie 过期 → 更新 HEYBOX_COOKIE Secret
- API Key 错误 → 更新 OPENAI_API_KEY Secret
- 小黑盒 API 变更 → 等我修复代码

**Q: 怎么手动触发运行？**
A: Actions → Auto Sync and Deploy → Run workflow

**Q: 能看到同步进度吗？**
A: 在 Actions 运行详情里可以看到实时日志，包括同步进度、图片下载进度。

**Q: 部署后网站地址是什么？**
A: `https://你的用户名.github.io/xiaoheihe-favourites/`

## 回退到本地方案

如果 GitHub Actions 方案不稳定，可以随时改回本地方案：
1. 本地运行应用同步收藏
2. 导出静态站点
3. 把导出的文件推送到 GitHub 仓库的 gh-pages 分支

两种方案可以并存，GitHub Actions 失败了不影响本地使用。
