/**
 * 图片修复脚本：重新下载所有丢失/缺失的帖子正文图片
 *
 * 用法: node scripts/repair-images.js [--concurrency=5]
 *
 * 功能:
 * 1. 扫描所有帖子，从 text/imgs/hb_rich_texts 提取正文图片（不再过滤 /live/）
 * 2. 检查本地封面文件是否存在，丢失则重新下载
 * 3. 没有本地图片的帖子，若 raw_data 中有图片也会下载
 * 4. 第一张图作为封面，更新数据库
 */
const Database = require('better-sqlite3');
const https = require('https');
const fs = require('fs');
const path = require('path');

const CONCURRENCY = parseInt((process.argv.find(a => a.startsWith('--concurrency=')) || '').split('=')[1]) || 5;
const MEDIA_DIR = path.join(process.cwd(), 'media');
const DB_PATH = path.join(process.cwd(), 'data', 'app.db');

if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

const db = new Database(DB_PATH);

// 提取帖子正文图片（与修复后的后端逻辑一致）
function extractPostImages(raw) {
  const images = [];
  const seen = new Set();
  const addImage = (url) => {
    if (url && typeof url === 'string') {
      const cleanUrl = url.split('?')[0];
      if (!seen.has(cleanUrl)) {
        seen.add(cleanUrl);
        images.push(url);
      }
    }
  };

  // 1. text 富文本
  if (raw.text) {
    try {
      const arr = typeof raw.text === 'string' ? JSON.parse(raw.text) : raw.text;
      if (Array.isArray(arr)) arr.forEach(n => { if (n && n.type === 'img' && n.url) addImage(n.url); });
    } catch {}
  }
  // 2. imgs
  if (images.length === 0 && Array.isArray(raw.imgs)) {
    raw.imgs.forEach(u => addImage(u));
  }
  // 3. hb_rich_texts
  if (images.length === 0 && Array.isArray(raw.hb_rich_texts)) {
    raw.hb_rich_texts.forEach(n => { if (n && n.type === 'img' && n.url) addImage(n.url); });
  }
  return images;
}

function downloadImage(imageUrl, linkid, index) {
  return new Promise((resolve) => {
    const cleanUrl = imageUrl.split('?')[0];
    const ext = cleanUrl.split('.').pop()?.toLowerCase() || 'jpg';
    const safeExt = ['jpg','jpeg','png','gif','webp','bmp'].includes(ext) ? ext : 'jpg';
    const fileName = `post_${linkid}_${index}.${safeExt}`;
    const filePath = path.join(MEDIA_DIR, fileName);

    // 已存在且非空，跳过
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      return resolve({ fileName, skipped: true });
    }

    let urlObj;
    try { urlObj = new URL(cleanUrl); } catch { return resolve(null); }

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://xiaoheihe.cn/',
      },
      timeout: 15000,
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.length === 0) return resolve(null);
        try {
          fs.writeFileSync(filePath, buf);
          resolve({ fileName, size: buf.length });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const allItems = db.prepare('SELECT id, linkid, title, raw_data, local_cover_path FROM archive_item WHERE is_deleted=0').all();
  console.log(`共 ${allItems.length} 个帖子，开始扫描需要修复的图片...`);

  // 找出需要下载的帖子
  const needRepair = [];
  for (const item of allItems) {
    let raw;
    try { raw = JSON.parse(item.raw_data); } catch { continue; }
    const images = extractPostImages(raw);
    if (images.length === 0) continue;

    // 判断封面文件是否丢失
    let coverMissing = true;
    if (item.local_cover_path) {
      const rel = item.local_cover_path.replace('./', '').replace(/^\//, '');
      const full = path.join(process.cwd(), rel);
      coverMissing = !fs.existsSync(full) || fs.statSync(full).size === 0;
    }
    if (coverMissing) {
      needRepair.push({ ...item, images });
    }
  }

  console.log(`需要修复图片的帖子: ${needRepair.length} 个`);
  if (needRepair.length === 0) {
    console.log('所有图片都完好，无需修复。');
    db.close();
    return;
  }

  let idx = 0;
  let okCount = 0, failCount = 0, totalImgs = 0;

  async function worker() {
    while (idx < needRepair.length) {
      const cur = idx++;
      const item = needRepair[cur];
      try {
        let allOk = true;
        for (let i = 0; i < item.images.length; i++) {
          const r = await downloadImage(item.images[i], item.linkid, i);
          if (r) { if (!r.skipped) totalImgs++; }
          else allOk = false;
          await sleep(30 + Math.floor(Math.random() * 50));
        }
        if (allOk && item.images.length > 0) {
          const firstClean = item.images[0].split('?')[0];
          const ext = firstClean.split('.').pop()?.toLowerCase() || 'jpg';
          const safeExt = ['jpg','jpeg','png','gif','webp','bmp'].includes(ext) ? ext : 'jpg';
          const coverPath = `./media/post_${item.linkid}_0.${safeExt}`;
          db.prepare('UPDATE archive_item SET local_cover_path=?, cover_url=? WHERE id=?')
            .run(coverPath, item.images[0], item.id);
          okCount++;
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
        console.error(`修复失败 linkid=${item.linkid}:`, e.message);
      }
      if ((cur + 1) % 10 === 0 || cur + 1 === needRepair.length) {
        console.log(`进度: ${cur + 1}/${needRepair.length}, 成功 ${okCount}, 失败 ${failCount}, 新下载 ${totalImgs} 张`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log('\n=== 修复完成 ===');
  console.log(`成功: ${okCount}, 失败: ${failCount}, 新下载图片: ${totalImgs} 张`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
