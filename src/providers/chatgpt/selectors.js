const selectors = {
  historyNavigation: 'nav[aria-label="历史聊天记录"], nav[aria-label="Chat history"], nav[aria-label="侧边栏"]',
  conversationLinks: 'nav[aria-label="历史聊天记录"] a[href*="/c/"], nav[aria-label="Chat history"] a[href*="/c/"], nav[aria-label="侧边栏"] a[href*="/c/"]',
  messageRoles: '[data-message-author-role]',
  markdown: ".markdown",
  composer: 'textarea[placeholder*="ChatGPT"], textarea[placeholder*="发送消息"], #prompt-textarea',
  headerOptions: '[data-testid="conversation-options-button"], button[aria-label="Open conversation options"], button[aria-label="打开对话选项"]',
  openMenus: '[role="menu"][data-state="open"], [role="menu"]:visible',
  projectName: '[role="dialog"] input[placeholder="Project name"], [role="dialog"] input[placeholder="项目名称"]',
  alerts: '[role="alert"]',
};

const patterns = {
  login: /log in|sign up|登录|注册/i,
  move: /move to project|移动到项目/i,
  archive: /archive|归档/i,
  rateLimit: /too many requests|rate limit|请求过多|请求过于频繁/i,
  accessRestriction: /access denied|verify you are human|just a moment|访问被拒绝|验证您是真人/i,
};

module.exports = { selectors, patterns };
