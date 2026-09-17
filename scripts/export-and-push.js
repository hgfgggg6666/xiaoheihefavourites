/**
 * 本地导出静态站点并部署到 GitHub Pages (gh-pages 分支)
 *
 * 用法: node scripts/export-and-push.js
 *
 * 流程:
 * 1. 启动本地应用（若 3000 端口已有应用在跑则复用）
 * 2. 调用 /api/static-export/download 导出完整静态站点 zip
 * 3. 解压到 exported-site/
 * 4. 检查数据非空
 * 5. 在 exported-site 内初始化独立 git 仓库，推送到 origin 的 gh-pages 分支（--force）
 *    —— 不触碰主项目工作区、不切换分支、不影响 main
 */
const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const EXPORT_DIR = path.join(process.cwd(), 'exported-site');
const ZIP_PATH = path.join(process.cwd(), 'archive-site.zip');
const GH_PAGES_BRANCH = 'gh-pages';
const REMOTE_URL = execSync('git config --get remote.origin.url', { encoding: 'utf-8' }).trim() ||
  'https://github.com/hgfgggg6666/xiaoheihefavourites.git';

let serverProcess = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function apiGet(apiPath) {
  const res = await httpRequest({ hostname: 'localhost', port: 3000, path: apiPath, method: 'GET' });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.data.toString());
}

// 检查 3000 端口是否已有应用在跑
function isServerUp() {
  return new Promise((resolve) => {
    const req = http.get({ hostname: 'localhost', port: 3000, path: '/api/archives/stats', timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForServer(maxRetries = 90) {
  console.log('等待应用启动...');
  await sleep(4000);
  for (let i = 0; i < maxRetries; i++) {
    if (serverProcess && serverProcess.exitCode !== null) {
      console.error(`应用进程已退出，exitCode: ${serverProcess.exitCode}`);
      return false;
    }
    try {
      await apiGet('/api/archives/stats');
      console.log('应用已启动！');
      return true;
    } catch {
      process.stdout.write('.');
      await sleep(1000);
    }
  }
  console.log('应用启动超时');
  return false;
}

async function main() {
  console.log('=== 本地导出静态站点并部署到 GitHub Pages ===\n');

  // 1. 启动应用（若端口被占用且能访问则复用）
  console.log('检查本地应用...');
  if (await isServerUp()) {
    console.log('检测到 3000 端口已有应用在运行，直接复用');
  } else {
    console.log('启动本地应用...');
    serverProcess = spawn('node', ['dist/server/main.js'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        FORCE_AUTHN_INNERAPI_DOMAIN: 'http://localhost:3000',
        NODE_ENV: 'production',
        PORT: '3000',
      },
    });
    const ready = await waitForServer();
    if (!ready) {
      console.error('应用启动失败');
      if (serverProcess) serverProcess.kill();
      process.exit(1);
    }
  }

  // 2. 校验数据
  console.log('\n校验本地数据...');
  let stats;
  try {
    stats = await apiGet('/api/archives/stats');
    console.log(`  收藏总数: ${stats.totalItems}`);
    console.log(`  未打标签: ${stats.untaggedCount}`);
  } catch (e) {
    console.error(`数据校验失败: ${e.message}`);
    if (serverProcess) serverProcess.kill();
    process.exit(1);
  }

  if (!stats.totalItems || stats.totalItems === 0) {
    console.error('本地数据库为空，无法导出');
    if (serverProcess) serverProcess.kill();
    process.exit(1);
  }

  // 3. 导出静态站点
  console.log('\n导出静态站点...');
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(ZIP_PATH);
    http.get(`${BASE_URL}/api/static-export/download`, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`导出失败: HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
  console.log('导出完成');

  // 4. 解压
  console.log('\n解压静态站点...');
  if (fs.existsSync(EXPORT_DIR)) {
    fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  try {
    execSync(`tar -xf "${ZIP_PATH}" -C "${EXPORT_DIR}"`, { stdio: 'inherit' });
  } catch {
    try {
      execSync(`unzip -o "${ZIP_PATH}" -d "${EXPORT_DIR}"`, { stdio: 'inherit' });
    } catch {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(ZIP_PATH);
      zip.extractAllTo(EXPORT_DIR, true);
    }
  }
  console.log('解压完成');

  // 5. 校验导出内容
  const dataFile = path.join(EXPORT_DIR, 'data', 'archive.js');
  if (!fs.existsSync(dataFile)) {
    console.error('导出缺少 data/archive.js');
    if (serverProcess) serverProcess.kill();
    process.exit(1);
  }
  const dataContent = fs.readFileSync(dataFile, 'utf-8');
  const match = dataContent.match(/window\.__ARCHIVE__\s*=\s*(\{.*\});?/s);
  if (match) {
    const parsed = JSON.parse(match[1]);
    console.log(`  导出的收藏数: ${parsed.total}`);
    console.log(`  分类数: ${(parsed.categories || []).length}`);
    console.log(`  标签数: ${(parsed.allTags || []).length}`);
    if (parsed.total !== stats.totalItems) {
      console.warn(`  警告: 导出收藏数(${parsed.total})与数据库(${stats.totalItems})不一致`);
    }
  }

  function countFiles(dir) {
    let count = 0;
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const full = path.join(dir, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) count += countFiles(full);
      else count++;
    }
    return count;
  }
  const totalFiles = countFiles(EXPORT_DIR);
  const totalSizeMB = (fs.statSync(ZIP_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`  导出文件数: ${totalFiles}`);
  console.log(`  ZIP 大小: ${totalSizeMB} MB`);

  // 6. 停止我们启动的应用（如果是复用的则不停止）
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    console.log('\n本地应用已停止');
  }

  // 7. 在 exported-site 内创建独立 git 仓库并推送到 gh-pages 分支
  console.log(`\n推送到 ${GH_PAGES_BRANCH} 分支 (${REMOTE_URL})...`);
  execSync(`git init -b ${GH_PAGES_BRANCH}`, { cwd: EXPORT_DIR, stdio: 'inherit' });
  execSync('git add -A', { cwd: EXPORT_DIR, stdio: 'inherit' });
  try {
    execSync(`git commit -m "本地导出静态站点: ${stats.totalItems} 条收藏 (${new Date().toISOString().slice(0, 10)})"`, { cwd: EXPORT_DIR, stdio: 'inherit' });
  } catch (e) {
    console.log('没有新变更可提交');
  }
  execSync(`git remote add origin ${REMOTE_URL}`, { cwd: EXPORT_DIR, stdio: 'inherit' });
  execSync(`git push origin ${GH_PAGES_BRANCH} --force`, { cwd: EXPORT_DIR, stdio: 'inherit' });

  // 8. 清理临时文件
  fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
  fs.rmSync(ZIP_PATH, { force: true });

  console.log('\n=== 部署完成 ===');
  console.log(`已推送到 ${GH_PAGES_BRANCH} 分支，共 ${stats.totalItems} 条收藏`);
  console.log('\n下一步（需要你在 GitHub 网页上操作一次）：');
  console.log('仓库 Settings → Pages → Build and deployment → Source 选 "Deploy from a branch"');
  console.log('Branch 选 gh-pages，目录 / (root)，点 Save');
  console.log('等待 1-2 分钟，网站就会显示本地数据了。');
}

main().catch((e) => {
  console.error('执行失败:', e.message);
  if (serverProcess) serverProcess.kill();
  process.exit(1);
});
