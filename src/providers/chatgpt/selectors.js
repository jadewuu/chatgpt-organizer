const selectors = {
  historyNavigation: 'nav[aria-label="历史聊天记录"], nav[aria-label="Chat history"], nav[aria-label="侧边栏"]',
  conversationLinks: 'nav[aria-label="历史聊天记录"] a[href*="/c/"], nav[aria-label="Chat history"] a[href*="/c/"], nav[aria-label="侧边栏"] a[href*="/c/"]',
  messageRoles: '[data-message-author-role]',
  markdown: ".markdown",
  composer: 'textarea[placeholder*="ChatGPT"], textarea[placeholder*="发送消息"], #prompt-textarea',
  headerOptions: '[data-testid="conversation-options-button"], button[aria-label="Open conversation options"], button[aria-label="打开对话选项"]',
  openMenus: '[role="menu"][data-state="open"], [role="menu"]:visible',
  projectName: '#project-name, [role="dialog"] input[placeholder="Project name"], [role="dialog"] input[placeholder="项目名称"]',
  createProjectControl: '[data-testid="create-project-button"], button[aria-label="New project"], button[aria-label="新项目"], button[aria-label="新建项目"], button[aria-label="创建项目"]',
  projectDialogSubmit: '[role="dialog"] button[type="submit"], [role="dialog"] button[data-testid="create-project-submit"], [role="dialog"] button',
  openMenuItems: '[data-radix-menu-content] [role="menuitem"], [role="menu"][data-state="open"] [role="menuitem"], [role="menu"] [role="menuitem"]',
  projectChoices: '[data-radix-menu-content] [role="menuitem"], [role="dialog"] [role="option"], [role="dialog"] [role="menuitem"], [role="listbox"] [role="option"]',
  renderedConversation: 'main [data-message-author-role]',
  conversationProject: 'header [data-testid="conversation-project-name"], [data-testid="conversation-project-breadcrumb"] [aria-current="page"], [data-testid="conversation-project-ownership"]',
  archivedState: 'main [data-testid="archived-conversation-indicator"], header [data-testid="archived-conversation-indicator"]',
  safetyText: '[role="alert"], [role="status"], main h1, main h2, [data-testid*="challenge"]',
  workspaceContext: '[data-testid="workspace-switcher"] [aria-current="true"], [data-testid="workspace-name"]',
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
  move: /move to project|移动到项目|移至项目/i,
  archive: /archive|归档|存档/i,
  createProject: /^(?:new|create) project$|^(?:新项目|新建项目|创建项目)$/i,
  projectSubmit: /^(?:create|create project|创建|创建项目)$/i,
  moveControl: /^move to project$|^(?:移动到|移至)项目$/i,
  archiveControl: /^archive$|^[归存]档$/i,
  destructiveControl: /^(?:delete|remove)(?: conversation| chat)?$|^(?:删除|移除)(?:对话|聊天)?$/i,
  archivedState: /^(?:archived|conversation archived|已归档|已存档)[.!。]?$/i,
  rateLimit: /too many requests|rate limit|请求过多|请求过于频繁/i,
  accessRestriction: /access denied|verify you are human|verification challenge|just a moment|访问被拒绝|验证您是真人|安全验证/i,
  loggedOutPath: /^\/(?:auth\/login|auth\/logout)(?:\/|$)/,
  challengePath: /^\/(?:challenge|cdn-cgi)(?:\/|$)/,
  // URL shape is a fail-closed candidate, not a live-verified provider contract.
  projectPath: /^\/g\/g-p-[A-Za-z0-9_-]+\/project$/,
  noProjects: /^(no projects(?: yet)?|you (?:don't|do not) have any projects(?: yet)?|暂无项目|尚无项目|还没有项目)[.!。]?$/i,
  moreProjects: /^(show more|see all|view all)(?: projects)?$|^(更多|查看全部|显示更多)(?:项目)?$/i,
};

module.exports = { selectors, patterns };
