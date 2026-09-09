/**
 * 自动化脚本：启动应用 → 同步收藏夹 → 下载图片 → 导出静态站点
 * 用于 GitHub Actions 完全自动化部署
 */

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE_URL = 'http://localhost:3000';
const EXPORT_DIR = path.join(process.cwd(), 'exported-site');
const ZIP_PATH = path.join(process.cwd(), 'archive-site.zip');

let serverProcess = null;

// ============== 工具函数 ==============

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function apiGet(path) {
  const res = await httpRequest({
    hostname: 'localhost',
    port: 3000,
    path,
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  return JSON.parse(res.data.toString());
}

async function apiPost(path, data = {}) {
  const body = JSON.stringify(data);
  const res = await httpRequest({
    hostname: 'localhost',
    port: 3000,
    path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
  return JSON.parse(res.data.toString());
}

async function waitForServer(maxRetries = 30) {
  console.log('等待应用启动...');
  for (let i = 0; i < maxRetries; i++) {
    try {
      await apiGet('/api/archives/stats');
      console.log('应用已启动！');
      return true;
    } catch {
      process.stdout.write('.');
      await sleep(1000);
    }
  }
  console.log('\n应用启动超时');
  return false;
}

async function waitForJob(statusPath, jobName, maxTime = 600000) {
  console.log(`等待${jobName}完成...`);
  const startTime = Date.now();
  let lastProcessed = -1;

  while (Date.now() - startTime < maxTime) {
    try {
      const status = await apiGet(statusPath);
      if (status.status === 'success') {
        console.log(`${jobName}完成！成功: ${status.successCount}, 失败: ${status.failCount}`);
        return true;
      }
      if (status.status === 'failed') {
        console.log(`${jobName}失败: ${status.errorMessage}`);
        return false;
      }
      if (status.processed !== lastProcessed) {
        console.log(`${jobName}进度: ${status.processed}/${status.total}`);
        lastProcessed = status.processed;
      }
      await sleep(3000);
    } catch (e) {
      console.log(`${jobName}查询出错: ${e.message}`);
      await sleep(3000);
    }
  }
  console.log(`${jobName}超时`);
  return false;
}

// ============== 主流程 ==============

async function main() {
  console.log('=== 小黑盒收藏自动同步脚本 ===\n');

  // 1. 检查必要的环境变量
  const cookie = process.env.HEYBOX_COOKIE;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const openaiBaseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const openaiTemperature = parseFloat(process.env.OPENAI_TEMPERATURE || '0.3');

  if (!cookie) {
    console.error('错误：未设置 HEYBOX_COOKIE 环境变量');
    process.exit(1);
  }
  if (!openaiApiKey) {
    console.error('错误：未设置 OPENAI_API_KEY 环境变量');
    process.exit(1);
  }

  console.log('环境变量检查通过');
  console.log(`  - OpenAI Base URL: ${openaiBaseUrl}`);
  console.log(`  - OpenAI Model: ${openaiModel}`);

  // 2. 启动应用
  console.log('\n启动应用...');
  serverProcess = spawn('node', ['dist/server/main.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      FORCE_AUTHN_INNERAPI_DOMAIN: 'http://localhost:3000',
      NODE_ENV: 'production',
      PORT: '3000',
    },
  });

  // 3. 等待应用启动
  const serverReady = await waitForServer();
  if (!serverReady) {
    console.error('应用启动失败');
    cleanup();
    process.exit(1);
  }

  // 4. 保存设置
  console.log('\n保存设置...');
  try {
    await apiPost('/api/settings', {
      heyboxCookie: cookie,
      openaiBaseUrl,
      openaiApiKey,
      openaiModel,
      openaiTemperature,
    });
    console.log('设置保存成功');
  } catch (e) {
    console.log('设置保存可能已存在，继续...');
  }

  // 5. 同步收藏夹
  console.log('\n开始同步收藏夹...');
  try {
    const syncResult = await apiPost('/api/heybox/sync');
    console.log(`同步任务已创建: ${syncResult.jobId || JSON.stringify(syncResult)}`);
  } catch (e) {
    console.log(`同步任务创建: ${e.message}`);
  }

  const syncSuccess = await waitForJob('/api/heybox/sync-status', '收藏夹同步');
  if (!syncSuccess) {
    console.log('收藏夹同步失败，继续后续步骤...');
  }

  // 6. 下载图片
  console.log('\n开始下载图片...');
  try {
    const imgResult = await apiPost('/api/heybox/image-archive');
    console.log(`图片下载任务已创建: ${imgResult.jobId || JSON.stringify(imgResult)}`);
  } catch (e) {
    console.log(`图片下载任务创建: ${e.message}`);
  }

  const imgSuccess = await waitForJob('/api/heybox/image-archive-status', '图片下载', 900000);
  if (!imgSuccess) {
    console.log('图片下载部分失败，继续导出...');
  }

  // 7. 导出静态站点
  console.log('\n开始导出静态站点...');
  try {
    // 导出是流式下载，直接用 http 模块下载
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(ZIP_PATH);
      http.get(`${BASE_URL}/api/static-export/download`, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`导出失败: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log('静态站点导出完成');
          resolve();
        });
      }).on('error', reject);
    });
  } catch (e) {
    console.error(`导出失败: ${e.message}`);
    cleanup();
    process.exit(1);
  }

  // 8. 解压导出的 zip
  console.log('\n解压导出的站点...');
  if (fs.existsSync(EXPORT_DIR)) {
    fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(EXPORT_DIR, { recursive: true });

  try {
    execSync(`unzip -o "${ZIP_PATH}" -d "${EXPORT_DIR}"`, { stdio: 'inherit' });
    console.log('解压完成');
  } catch (e) {
    // 如果 unzip 不可用，用 Node.js 解压
    console.log('使用 Node.js 解压...');
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(ZIP_PATH);
    zip.extractAllTo(EXPORT_DIR, true);
    console.log('解压完成');
  }

  // 列出导出的文件
  console.log('\n导出的文件:');
  function listFiles(dir, prefix = '') {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        console.log(`${prefix}${item}/`);
        listFiles(fullPath, prefix + '  ');
      } else {
        console.log(`${prefix}${item} (${(stat.size / 1024).toFixed(1)} KB)`);
      }
    }
  }
  listFiles(EXPORT_DIR);

  // 9. 清理
  cleanup();

  console.log('\n=== 自动同步完成！===');
  console.log(`静态站点已导出到: ${EXPORT_DIR}`);
  console.log('GitHub Actions 将自动部署到 GitHub Pages');
}

function cleanup() {
  if (serverProcess) {
    console.log('\n关闭应用...');
    serverProcess.kill();
    serverProcess = null;
  }
  // 清理临时文件
  if (fs.existsSync(ZIP_PATH)) {
    fs.unlinkSync(ZIP_PATH);
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

main().catch((e) => {
  console.error('脚本执行失败:', e);
  cleanup();
  process.exit(1);
});
