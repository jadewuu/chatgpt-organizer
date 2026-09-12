// 04-read.js — 读取 conversation 内容(只读)
//
// 用法:
//   node scripts/04-read.js <conversation_id> [...]  读取指定对话(完整 ID 或前缀)
//   node scripts/04-read.js --sample N               从 conversations.json 读前 N 条
//
// 输出: data/extracted/<conversation_id>.json
//   { conversation_id, title, url, messages: [{ role, text }] }
//
// 关键机制(排查后确认):
//   - 用"截断短 ID"直接导航 /c/<id> 会被 SPA 重定向回首页。
//   - 用"完整 UUID"导航则能正常打开(SPA 路由能匹配完整 ID)。
//   - 因此本脚本先把输入解析为完整 UUID(从 conversations.json 查找),再通过
//     location.href 软导航打开,等待消息渲染后提取。
//
// 安全:仅导航 + 读取文本。不发送消息、不点击任何写操作按钮。

const fs = require("fs");
const path = require("path");
const { launch, goto, getPage, close } = require("./lib/browser");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data", "extracted");

/** 把用户输入的 ID(可能是前缀)解析为完整 UUID,查 conversations.json */
function resolveId(input) {
  const list = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "conversations.json"), "utf8"));
  const exact = list.find((c) => c.conversation_id === input);
  if (exact) return exact.conversation_id;
  const byPrefix = list.find((c) => c.conversation_id.startsWith(input));
  if (byPrefix) return byPrefix.conversation_id;
  return input; // 未找到则原样用(可能直接是完整 ID)
}

async function extractConversation(page, input) {
  const cid = resolveId(input);
  const url = `https://chatgpt.com/c/${cid}`;

  // 软导航:先确认在 chatgpt.com,再用 location.href 跳转。
  // 导航会销毁执行上下文,忽略该错误(导航本身已触发)。
  try {
    await page.evaluate((u) => { location.href = u; }, url);
  } catch {}

  // 等待消息渲染(容忍导航期间的上下文销毁,重试)
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    let st = null;
    try {
      st = await page.evaluate(() => ({
        authorRoles: document.querySelectorAll('[data-message-author-role]').length,
        url: location.href,
      }));
    } catch { continue; }
    if (st.authorRoles > 0) { ready = true; break; }
  }
  if (!ready) {
    console.log(`  [${cid}] 打开后未提取到消息(可能已删除或加载失败)`);
    return null;
  }
  await page.waitForTimeout(1200);

  let data = null;
  for (let i = 0; i < 10; i++) {
    try {
      data = await page.evaluate(() => {
        const title = document.title.replace(/\s*[-|]\s*ChatGPT.*$/i, "").trim();
        const messages = [];
        for (const n of document.querySelectorAll('[data-message-author-role]')) {
          const role = n.getAttribute("data-message-author-role");
          const md = n.querySelector(".markdown");
          const text = ((md || n).innerText || (md || n).textContent || "").trim();
          messages.push({ role, text });
        }
        return { title, messages };
      });
      break;
    } catch { await page.waitForTimeout(500); }
  }
  if (!data) { console.log(`  [${cid}] 提取失败`); return null; }

  const rec = {
    conversation_id: cid,
    title: data.title,
    url: `https://chatgpt.com/c/${cid}`,
    extracted_at: new Date().toISOString(),
    messages: data.messages.map((m) => ({ role: m.role, text: m.text.slice(0, 20000) })),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${cid}.json`), JSON.stringify(rec, null, 2));
  const roles = [...new Set(rec.messages.map((m) => m.role))].join(",");
  console.log(`  ✓ ${cid.slice(0, 8)} "${rec.title}" 消息=${rec.messages.length} [${roles}]`);
  return rec;
}

(async () => {
  const args = process.argv.slice(2);
  const headless = args.includes("--headless");
  let page = await launch({ headless });
  await goto("https://chatgpt.com/");
  await page.waitForTimeout(5000);

  async function rebrowser() {
    // 关闭当前浏览器并重启(重置长时间运行的内存/状态)
    try { await close(); } catch {}
    page = await launch({ headless });
    await goto("https://chatgpt.com/");
    await page.waitForTimeout(4000);
    console.log("  浏览器已重启。");
  }

  if (args[0] === "--all") {
    // 全量读取 conversations.json,跳过已提取的(断点续跑友好)
    const maxIdx = args.indexOf("--max");
    const maxNew = maxIdx !== -1 ? parseInt(args[maxIdx + 1], 10) : Infinity;
    const delayIdx = args.indexOf("--delay");
    const delay = delayIdx !== -1 ? parseInt(args[delayIdx + 1], 10) : 2500;
    const ceIdx = args.indexOf("--cooldown-every");
    const cooldownEvery = ceIdx !== -1 ? parseInt(args[ceIdx + 1], 10) : 0;
    const csIdx = args.indexOf("--cooldown-secs");
    const cooldownSecs = csIdx !== -1 ? parseInt(args[csIdx + 1], 10) : 60;
    const rbIdx = args.indexOf("--rebrowser-every");
    const rebrowserEvery = rbIdx !== -1 ? parseInt(args[rbIdx + 1], 10) : 0;
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "conversations.json"), "utf8"));
    const existing = new Set(fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")) : []);
    const pending = list.filter((c) => !existing.has(c.conversation_id));
    console.log(`全量读取:共 ${list.length},已提取 ${list.length - pending.length},待读 ${pending.length}${Number.isFinite(maxNew) ? `,本轮上限 ${maxNew}` : ""}`);
    let fail = [];
    let done = 0;
    for (let i = 0; i < pending.length; i++) {
      const c = pending[i];
      try {
        await extractConversation(page, c.conversation_id);
        done++;
      } catch (e) {
        fail.push(c.conversation_id);
        console.log(`  [${c.conversation_id.slice(0, 8)}] 异常:`, e.message.slice(0, 80));
      }
      if ((i + 1) % 25 === 0) console.log(`  进度 ${i + 1}/${pending.length}`);
      await page.waitForTimeout(delay);
      if (done >= maxNew) { console.log(`  达到本轮上限 ${maxNew},停止。`); break; }
      if (cooldownEvery > 0 && done > 0 && done % cooldownEvery === 0) {
        console.log(`  冷却 ${cooldownSecs}s...`);
        await page.waitForTimeout(cooldownSecs * 1000);
      }
      if (rebrowserEvery > 0 && done > 0 && done % rebrowserEvery === 0) {
        console.log(`  已读 ${done} 条,重启浏览器...`);
        await rebrowser();
      }
    }
    if (fail.length) {
      console.log(`\n首次失败 ${fail.length} 条,重试...`);
      for (const id of fail) {
        try { await extractConversation(page, id); }
        catch (e) { console.log(`  [${id.slice(0, 8)}] 重试仍失败:`, e.message.slice(0, 80)); }
        await page.waitForTimeout(400);
      }
    }
    console.log("本轮结束。");
  } else if (args[0] === "--sample") {
    const n = parseInt(args[1], 10) || 5;
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "conversations.json"), "utf8"));
    console.log(`批量读取前 ${n} 条...`);
    for (const c of list.slice(0, n)) {
      try { await extractConversation(page, c.conversation_id); }
      catch (e) { console.log(`  [${c.conversation_id.slice(0, 8)}] 失败:`, e.message.slice(0, 100)); }
      await page.waitForTimeout(600);
    }
  } else if (args[0]) {
    const ids = args.filter((a) => !a.startsWith("--"));
    for (const id of ids) {
      try { await extractConversation(page, id); }
      catch (e) { console.log(`  [${id}] 失败:`, e.message.slice(0, 100)); }
      await page.waitForTimeout(600);
    }
  } else {
    console.log("用法: node scripts/04-read.js <id> [<id>...] | --sample N");
  }

  await close();
})().catch(async (e) => { console.error("FATAL:", e.message); try { await close(); } catch {} process.exit(1); });
