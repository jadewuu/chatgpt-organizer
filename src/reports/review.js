const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "—") {
  return escapeHtml(value === null || value === undefined || value === "" ? fallback : value);
}

function confidence(value) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return `${number.toFixed(2)} (${(number * 100).toFixed(1)}%)`;
}

function row(item) {
  const project = item.project ?? "";
  const action = item.action || "keep";
  const suggestedAction = item.suggestedAction || action;
  const reason = item.reason || "No explanation provided";
  const archiveReason = item.archiveReason;
  return `<article class="review-row" data-review-row data-project="${escapeHtml(project)}" data-action="${escapeHtml(action)}" data-confidence="${escapeHtml(item.confidence)}">
  <h3>${text(item.title, "(untitled)")}</h3>
  <dl>
    <dt>Conversation ID</dt><dd><code>${text(item.conversationId)}</code></dd>
    <dt>URL</dt><dd><code>${text(item.url)}</code></dd>
    <dt>Current Project</dt><dd>${text(item.currentProject)}</dd>
    <dt>Proposed Project</dt><dd>${text(item.project)}</dd>
    <dt>Confidence</dt><dd>${confidence(item.confidence)}</dd>
    <dt>Suggested action</dt><dd>${text(suggestedAction)}</dd>
    <dt>Executable action</dt><dd>${text(action)}</dd>
    <dt>Status</dt><dd>${text(item.status)}</dd>
    <dt>Reason</dt><dd>${text(reason)}</dd>
    ${archiveReason === undefined ? "" : `<dt>Archive reason</dt><dd>${text(archiveReason)}</dd>`}
  </dl>
</article>`;
}

function bucket(title, items, emptyMessage) {
  const body = items.length ? items.map(row).join("\n") : `<p class="empty">${emptyMessage}</p>`;
  return `<section><h2>${title} <span class="count">${items.length}</span></h2>${body}</section>`;
}

function projectRows(planProjects, taxonomyProjects) {
  const entries = [];
  const seen = new Set();
  for (const project of [...planProjects, ...taxonomyProjects]) {
    const name = typeof project === "string" ? project : project?.name;
    if (typeof name !== "string" || seen.has(name)) continue;
    seen.add(name);
    const planProject = planProjects.find((item) => (typeof item === "string" ? item : item?.name) === name);
    const taxonomyProject = taxonomyProjects.find((item) => (typeof item === "string" ? item : item?.name) === name);
    entries.push({
      name,
      description: taxonomyProject?.description,
      exists: planProject?.exists,
      createRequired: planProject?.createRequired === true,
      count: Number.isInteger(planProject?.proposedConversationCount) ? planProject.proposedConversationCount : 0,
    });
  }
  return entries;
}

function renderReviewHtml({ plan = {}, taxonomy = {} } = {}) {
  const items = asArray(plan.items);
  const taxonomyProjects = asArray(taxonomy.projects);
  const projects = projectRows(asArray(plan.projects), taxonomyProjects);
  const proposedMoves = items.filter((item) => item?.action === "move");
  const unresolved = items.filter((item) => item?.status === "unresolved");
  const archiveCandidates = items.filter((item) => item?.suggestedAction === "archive");
  const classified = items.filter((item) => item?.project !== null && item?.project !== undefined).length;
  const createRequired = projects.filter((project) => project.createRequired);
  const projectOptions = projects.map((project) => `<option value="${escapeHtml(project.name)}">${text(project.name)}</option>`).join("");
  const projectTable = projects.length ? projects.map((project) => `<tr>
    <td>${text(project.name)}</td><td>${text(project.description)}</td><td>${project.exists === true ? "Existing" : project.exists === false ? "Not found" : "Unknown"}</td><td>${project.count}</td><td>${project.createRequired ? "Yes" : "No"}</td>
  </tr>`).join("\n") : `<tr><td colspan="5">No Projects in this plan.</td></tr>`;
  const createTable = createRequired.length ? createRequired.map((project) => `<li><strong>${text(project.name)}</strong> — ${text(project.description)}</li>`).join("\n") : "<li>None</li>";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ChatGPT Organizer Migration Review</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0 auto; max-width: 1100px; padding: 2rem; line-height: 1.45; }
header, section { margin-bottom: 2rem; }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: .75rem; }
.metric, .review-row { border: 1px solid #8886; border-radius: .5rem; padding: 1rem; }
.metric strong { display: block; font-size: 1.5rem; }
.filters { display: flex; flex-wrap: wrap; gap: .75rem; align-items: end; }
label { display: grid; gap: .25rem; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #8886; padding: .5rem; text-align: left; vertical-align: top; }
.review-row { margin: .75rem 0; }
.review-row dl { display: grid; grid-template-columns: minmax(9rem, 15rem) 1fr; gap: .25rem .75rem; }
.review-row dt { font-weight: 700; }
.review-row dd { margin: 0; overflow-wrap: anywhere; }
.count { font-size: .8em; font-weight: 400; }
.empty { opacity: .75; }
</style>
</head>
<body>
<header>
<h1>ChatGPT Organizer Migration Review</h1>
<p>This is a local, read-only review. No ChatGPT changes have been made.</p>
<p>Plan hash: <code>${text(plan.planHash)}</code></p>
</header>
<section aria-label="Summary">
<h2>Summary</h2>
<div class="summary">
  <div class="metric"><strong>${items.length}</strong>Total conversations</div>
  <div class="metric"><strong>${classified} / ${items.length}</strong>Coverage</div>
  <div class="metric"><strong>${proposedMoves.length}</strong>Proposed moves</div>
  <div class="metric"><strong>${unresolved.length}</strong>Unresolved</div>
  <div class="metric"><strong>${archiveCandidates.length}</strong>Archive candidates</div>
  <div class="metric"><strong>${projects.length}</strong>Projects</div>
</div>
</section>
<section>
<h2>Project counts</h2>
<table><thead><tr><th>Project</th><th>Description</th><th>Current inventory</th><th>Proposed conversations</th><th>createRequired</th></tr></thead><tbody>${projectTable}</tbody></table>
</section>
<section>
<h2>Projects to create</h2>
<ul>${createTable}</ul>
</section>
<section>
<h2>Local artifacts</h2>
<p>Review or edit the source files before approval:</p>
<ul><li><code>.local/plans/taxonomy.yaml</code></li><li><code>.local/plans/classifications.json</code></li><li><code>.local/plans/migration-plan.json</code></li></ul>
</section>
<section class="filters" aria-label="Filters">
<label>Project<select id="project-filter"><option value="">All Projects</option>${projectOptions}</select></label>
<label>Action<select id="action-filter"><option value="">All actions</option><option value="move">move</option><option value="keep">keep</option><option value="archive">archive</option></select></label>
<label>Minimum confidence<input id="confidence-filter" type="number" min="0" max="1" step="0.01" value="0"></label>
</section>
${bucket("Proposed moves", proposedMoves, "No proposed moves.")}
${bucket("Unresolved", unresolved, "No unresolved conversations.")}
${bucket("Archive candidates", archiveCandidates, "No archive candidates.")}
<script>
(() => {
  const rows = [...document.querySelectorAll("[data-review-row]")];
  const project = document.getElementById("project-filter");
  const action = document.getElementById("action-filter");
  const confidenceInput = document.getElementById("confidence-filter");
  function applyFilters() {
    const minimum = Number(confidenceInput.value) || 0;
    for (const item of rows) {
      item.hidden = (project.value && item.dataset.project !== project.value)
        || (action.value && item.dataset.action !== action.value)
        || Number(item.dataset.confidence) < minimum;
    }
  }
  project.addEventListener("change", applyFilters);
  action.addEventListener("change", applyFilters);
  confidenceInput.addEventListener("input", applyFilters);
})();
</script>
</body>
</html>
`;
}

module.exports = { renderReviewHtml, escapeHtml };
