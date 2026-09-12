// 01-discover.js — STEP 3/4/5: 发现全部 conversations(响应拦截 + 滚轮滚动)
//
// 方法:
//   1. 打开 chatgpt.com(专用 profile 已登录)
//   2. 监听 /backend-api/conversations 网络响应 —— SPA 滚动 sidebar 时会自动
//      分批请求(offset 分页),返回权威的对话列表(稳定 id + 标题 + 时间戳)
//   3. 用鼠标滚轮滚动 sidebar,触发 SPA 加载全部批次
//   4. 合并、去重,输出 data/conversations.json
//
// 为何不用 DOM 抓取:虚拟列表加载不稳定(scrollTop 跳转/滚轮有时不触发下一批),
// 且 DOM 只有渲染窗口里的元素。响应拦截拿的是 SPA 自己的数据,完整且稳定。
// 手动 fetch 会被 Cloudflare 拦截(403),但 SPA 原生请求不受影响。
//
// 安全:只读。仅监听响应 + 滚动。不发送消息、不点任何写操作按钮。
//
// 用法: node scripts/01-discover.js

const fs = require("fs");
const path = require("path");
const { launch, goto, getPage, close } = require("./lib/browser");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data", "conversations.json");
const API_PATTERN = /\/backend-api\/conversations(\?|$)/;

(async () => {
  const page = await launch({ headless: false });

  // 1. 拦截 conversations API 响应
  const apiItems = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (!API_PATTERN.test(url)) return;
    try {
      const json = await res.json();
      if (json && Array.isArray(json.items)) {
        apiItems.push(...json.items);
      }
    } catch {
      // 非 JSON 或已拦截,忽略
    }
  });

  console.log("Navigating to chatgpt.com ...");
  await goto("https://chatgpt.com/");

  // 2. 等待 sidebar 与首批对话
  console.log("Waiting for sidebar + conversation list...");
  let ok = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    const cnt = await page.locator('nav[aria-label="历史聊天记录"] a[href*="/c/"], nav[aria-label="Chat history"] a[href*="/c/"]').count();
    if (cnt > 0) { ok = true; break; }
  }
  if (!ok) {
    console.log("✗ 未检测到对话列表。检查登录态与页面结构。");
    await close();
    process.exit(2);
  }

  // 3. 定位鼠标到 sidebar,滚轮滚动触发全部批次
  const navEl = page.locator('nav[aria-label="历史聊天记录"], nav[aria-label="Chat history"]').first();
  const box = await navEl.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  console.log("Scrolling sidebar to trigger all batches...");
  let lastCount = -1;
  let stale = 0;
  let bottomRounds = 0;
  const STALE_EXIT = 6; // 到底且长时间无新批次才退出
  for (let i = 0; i < 300; i++) {
    // 每轮重新定位鼠标(布局可能变化)
    const box2 = await navEl.boundingBox();
    if (box2) await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);

    const m = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="历史聊天记录"], nav[aria-label="Chat history"]');
      if (!nav) return null;
      return { scrollTop: nav.scrollTop, scrollH: nav.scrollHeight, clientH: nav.clientHeight };
    });
    const atBottom = m && m.scrollH - m.clientH - m.scrollTop < 5;

    if (apiItems.length !== lastCount) {
      console.log(`  wheel ${i}: api items=${apiItems.length}${m ? ` scroll=${Math.round(m.scrollTop)}/${Math.round(m.scrollH - m.clientH)}` : ""}`);
      lastCount = apiItems.length;
      stale = 0;
    }

    if (atBottom) {
      stale++;
      bottomRounds++;
      if (stale >= STALE_EXIT) {
        // 到底多轮无新数据。轻推一次(上滚 150 再下滚)触发可能的加载。
        await page.mouse.wheel(0, -150);
        await page.waitForTimeout(600);
        await page.mouse.wheel(0, 150);
        await page.waitForTimeout(1200);
        const after = await page.evaluate(() => {
          const nav = document.querySelector('nav[aria-label="历史聊天记录"], nav[aria-label="Chat history"]');
          return nav ? nav.scrollHeight : 0;
        });
        if (after !== m.scrollH) {
          console.log("  nudge triggered more content, continuing...");
          stale = 0;
          continue;
        }
        console.log("  pinned at absolute bottom, nudge confirmed. Done.");
        break;
      }
    } else {
      stale = 0;
    }

    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(700);
  }
  if (bottomRounds === 0) console.log("  (loop ended without reaching bottom)");
  console.log("  total api items captured:", apiItems.length);

  // 4. 合并去重,输出
  const seen = new Map();
  for (const it of apiItems) {
    if (!it.id) continue;
    if (!seen.has(it.id)) seen.set(it.id, it);
  }

  const conversations = Array.from(seen.values()).map((it, i) => ({
    conversation_id: it.id,
    title: it.title || "(无标题)",
    create_time: it.create_time,
    update_time: it.update_time,
    discover_index: i,
  }));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(conversations, null, 2));
  console.log(`\n✓ Discovered ${conversations.length} conversations → ${path.relative(ROOT, OUT)}`);

  await close();
})().catch(async (e) => {
  console.error("FATAL:", e);
  try { await close(); } catch {}
  process.exit(1);
});
