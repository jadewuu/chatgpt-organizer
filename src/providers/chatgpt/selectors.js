const selectors = {
  historyNavigation: 'nav[aria-label="历史聊天记录"], nav[aria-label="Chat history"], nav[aria-label="侧边栏"]',
  conversationLinks: 'nav[aria-label="历史聊天记录"] a[href*="/c/"], nav[aria-label="Chat history"] a[href*="/c/"], nav[aria-label="侧边栏"] a[href*="/c/"]',
  messageRoles: '[data-message-author-role]',
  markdown: ".markdown",
  composer: 'textarea[placeholder*="ChatGPT"], textarea[placeholder*="发送消息"], #prompt-textarea',
  headerOptions: '[data-testid="conversation-options-button"], button[aria-label="Open conversation options"], button[aria-label="打开对话选项"]',
  openMenus: '[role="menu"][data-state="open"], [role="menu"]:visible',
  projectName: '[role="dialog"] input[placeholder="Project name"], [role="dialog"] input[placeholder="项目名称"]',
  // Conservative Project DOM candidates; authenticated live verification is still required.
  projectsRegion: 'nav[aria-label="Projects"], nav[aria-label="项目"], [role="region"][aria-label="Projects"], [role="region"][aria-label="项目"]',
  projectLinks: 'a[href]',
  projectUncertainState: '[aria-busy="true"], [aria-expanded="false"], [role="progressbar"], [role="alert"]',
  projectStatus: '[role="status"], p',
  projectControls: 'button, a',
  alerts: '[role="alert"]',
};

const patterns = {
  login: /log in|sign up|登录|注册/i,
  move: /move to project|移动到项目/i,
  archive: /archive|归档/i,
  rateLimit: /too many requests|rate limit|请求过多|请求过于频繁/i,
  accessRestriction: /access denied|verify you are human|just a moment|访问被拒绝|验证您是真人/i,
  // URL shape is a fail-closed candidate, not a live-verified provider contract.
  projectPath: /^\/g\/g-p-[A-Za-z0-9_-]+\/project$/,
  noProjects: /^(no projects(?: yet)?|you (?:don't|do not) have any projects(?: yet)?|暂无项目|尚无项目|还没有项目)[.!。]?$/i,
  moreProjects: /^(show more|see all|view all)(?: projects)?$|^(更多|查看全部|显示更多)(?:项目)?$/i,
};

module.exports = { selectors, patterns };
