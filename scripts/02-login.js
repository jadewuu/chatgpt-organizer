// 02-login.js — 在专用 profile 中一次性登录 ChatGPT
//
// 流程:
//   1. 启动专用 profile(headful,能看到窗口)
//   2. 打开 chatgpt.com
//   3. 由用户手动完成登录(邮箱/密码 或 Google SSO,含可能的验证码)
//   4. 脚本轮询页面,检测登录成功(sidebar 出现 / 无 Log in 按钮)
//   5. 成功后截图存档,写入 data/login-verified.json,关闭
//
// 之后所有扫描复用该 profile,登录态持久保持。
//
// 安全:只读 + 等待用户手动登录。本脚本不点击任何页面按钮(除了导航,由用户完成)。

const fs = require("fs");
const path = require("path");
const { launch, goto, getPage, close } = require("./lib/browser");

const ROOT = path.resolve(__dirname, "..");
const MARKER = path.join(ROOT, "data", "login-verified.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loginState(page) {
  // 返回 { loggedIn, detail }
  return page.evaluate(() => {
    const url = location.href;
    const isChatgpt = /chatgpt\.com/.test(url) && !/auth\./.test(url);
    const loginBtns = Array.from(document.querySelectorAll("button"))
      .map((b) => (b.getAttribute("aria-label") || "") + " " + (b.textContent || ""))
      .filter((t) => /log in/i.test(t) || /sign up/i.test(t) || t.includes("登录") || t.includes("注册"));
    const chatLinks = document.querySelectorAll('a[href*="/c/"]').length;
    const composer = document.querySelector('textarea[placeholder*="ChatGPT"], textarea[placeholder*="发送消息"], #prompt-textarea');
    const navSidebar = document.querySelector('nav[aria-label="Chat history"], nav[aria-label="侧边栏"]');
    return {
      isChatgpt,
      loginBtnCount: loginBtns.length,
      loginBtnSamples: loginBtns.slice(0, 3).map((t) => t.trim().slice(0, 30)),
      chatLinkCount: chatLinks,
      composerPresent: !!composer,
      sidebarPresent: !!navSidebar,
    };
  });
}

(async () => {
  // 若已登录过,直接提示跳过
  if (fs.existsSync(MARKER)) {
    console.log("已有登录标记,跳过。如需重新登录,删除 data/login-verified.json 后重跑。");
    process.exit(0);
  }

  const page = await launch({ headless: false });
  console.log("已打开专用 profile 窗口。导航到 chatgpt.com ...");
  await goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
  await sleep(4000);

  console.log("\n════════════════════════════════════════════════════════");
  console.log("  请在这个 Chrome 窗口里手动登录 ChatGPT。");
  console.log("  流程:点 Log in → 输入账号 → 完成验证(可能跳转 Google / 验证码)。");
  console.log("  登录完成后,本脚本会自动检测到并结束。");
  console.log("  最长等待 10 分钟。");
  console.log("════════════════════════════════════════════════════════\n");

  const deadline = Date.now() + 10 * 60 * 1000;
  let lastState = "";
  while (Date.now() < deadline) {
    let st;
    try {
      st = await loginState(page);
    } catch (e) {
      await sleep(2000);
      continue;
    }
    const summary = `url_ok=${st.isChatgpt} loginBtns=${st.loginBtnCount} chats=${st.chatLinkCount} composer=${st.composerPresent} sidebar=${st.sidebarPresent}`;
    if (summary !== lastState) {
      console.log("  [" + new Date().toLocaleTimeString() + "] " + summary);
      lastState = summary;
    }

    // 登录成功判定:在 chatgpt.com 且无 Log in 按钮,且出现会话侧栏或输入框
    if (st.isChatgpt && st.loginBtnCount === 0 && (st.sidebarPresent || st.composerPresent)) {
      console.log("\n✓ 检测到已登录。等待 3 秒确认会话渲染...");
      await sleep(3000);
      const st2 = await loginState(page);
      if (st2.isChatgpt && st2.loginBtnCount === 0) {
        console.log("✓ 登录确认。截图存档...");
        const shot = path.join(ROOT, "logs", "login-success.png");
        await page.screenshot({ path: shot });
        fs.mkdirSync(path.dirname(MARKER), { recursive: true });
        fs.writeFileSync(MARKER, JSON.stringify({ loggedIn: true, at: new Date().toISOString(), url: page.url() }, null, 2));
        console.log("✓ 已写入 data/login-verified.json");
        console.log("  URL:", page.url(), "| chats:", st2.chatLinkCount);
        await close();
        console.log("完成。后续脚本将复用此登录态。");
        process.exit(0);
      }
    }
    await sleep(2000);
  }

  console.log("\n✗ 10 分钟内未检测到登录完成。请检查窗口是否还开着、登录是否遇到问题。");
  await close();
  process.exit(1);
})().catch(async (e) => {
  console.error("FATAL:", e.message);
  try { await close(); } catch {}
  process.exit(1);
});
