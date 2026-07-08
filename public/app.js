// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  todos: [],
  done: [],
  projects: [],
  prs: [],
  codeTodos: [],
  codeFilter: { repo: 'all' },
  list: 'work',
  subTab: 'todo',
  filter: {
    priorities: new Set(['now', 'next']),
    project: 'all',
    search: '',
  },
  sort: { field: 'priority', dir: 'asc' },
};

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMd(text) {
  // Order matters: links before bold/code so URLs inside link text aren't re-processed
  return text
    // markdown links [label](url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) =>
      `<a href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(label)}</a>`)
    // bare URLs not already in a link
    .replace(/(?<![("'`>])https?:\/\/[^\s<)"'`\]]+/g, url =>
      `<a href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(url)}</a>`)
    // bold **text**
    .replace(/\*\*([^*]+)\*\*/g, (_, t) => `<strong>${escHtml(t)}</strong>`)
    // inline code `code`
    .replace(/`([^`]+)`/g, (_, t) => `<code>${escHtml(t)}</code>`)
    // escape remaining plain text (already processed segments are safe HTML)
    ;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Render inline — for segments that are already processed by renderMd, we need
// to handle the case where text may contain HTML from prior replacements.
// Instead, build a safe HTML string by processing the raw text.
function renderText(raw) {
  // We need to avoid double-escaping: process raw text, producing safe HTML.
  // Strategy: tokenise into plain-text runs and matched spans.
  let result = '';
  let rest = raw;

  const patterns = [
    // markdown link
    { re: /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)/, fn: m => `<a href="${escHtml(m[2])}" target="_blank" rel="noopener">${escHtml(m[1])}</a>` },
    // bare URL
    { re: /^https?:\/\/[^\s<)"'`\]]+/, fn: m => `<a href="${escHtml(m[0])}" target="_blank" rel="noopener">${escHtml(m[0])}</a>` },
    // bold
    { re: /^\*\*([^*]+)\*\*/, fn: m => `<strong>${renderText(m[1])}</strong>` },
    // inline code
    { re: /^`([^`]+)`/, fn: m => `<code>${escHtml(m[1])}</code>` },
  ];

  while (rest.length > 0) {
    let matched = false;
    for (const { re, fn } of patterns) {
      const m = re.exec(rest);
      if (m && m.index === 0) {
        result += fn(m);
        rest = rest.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Find next special char position
      const next = rest.search(/[*`[\]]|https?:\/\//);
      if (next === -1) {
        result += escHtml(rest);
        rest = '';
      } else if (next === 0) {
        result += escHtml(rest[0]);
        rest = rest.slice(1);
      } else {
        result += escHtml(rest.slice(0, next));
        rest = rest.slice(next);
      }
    }
  }
  return result;
}

// ─── Priority helpers ─────────────────────────────────────────────────────────

const PRIORITY_ORDER = { now: 0, next: 1, someday: 2, done: 3 };
const PRIORITY_LABEL = { now: 'Now', next: 'Next', someday: 'Someday', done: 'Done' };
const PRIORITY_CLASS = { now: 'p-now', next: 'p-next', someday: 'p-someday', done: 'p-done' };
const DEFAULT_VISIBLE_PRIORITIES = ['now', 'next', 'someday'];

// Keep list ownership explicit. New projects are treated as work until added here.
const PERSONAL_PROJECTS = new Set([
  'bambu-a1-bed-issue',
  'dashboard',
  'gridfinity',
  'home-assistant',
  'personal',
  'refugio-del-satiro',
]);

const LIST_LABEL = { work: 'Work', personal: 'Personal' };

function isPersonal(project) {
  return PERSONAL_PROJECTS.has(project) || project.startsWith('personal/');
}

function itemList(item) {
  return isPersonal(item.project) ? 'personal' : 'work';
}

function projectList(project) {
  return isPersonal(project) ? 'personal' : 'work';
}

function projectsForActiveList() {
  return state.projects.filter(project => projectList(project) === state.list);
}

function syncPriorityToggleButtons() {
  document.querySelectorAll('.priority-toggles .toggle-btn').forEach(btn => {
    btn.classList.toggle('active', state.filter.priorities.has(btn.dataset.priority));
  });
}

function matchesCurrentFilters(item, list = state.list) {
  const { priorities, project, search } = state.filter;
  const searchLow = search.toLowerCase();

  if (itemList(item) !== list) return false;
  if (!priorities.has(item.priority)) return false;
  if (project !== 'all' && item.project !== project) return false;
  if (searchLow && !item.text.toLowerCase().includes(searchLow) &&
      !item.project.toLowerCase().includes(searchLow)) return false;
  return true;
}

// ─── Filtering & sorting ──────────────────────────────────────────────────────

function visibleItems() {
  const pool = [
    ...state.todos,
    ...(state.filter.priorities.has('done') ? state.done : []),
  ];

  return pool.filter(item => matchesCurrentFilters(item)).sort((a, b) => {
    const { field, dir } = state.sort;
    let cmp = 0;
    if (field === 'priority') {
      cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (cmp === 0) cmp = (a.dueDate || 'z') < (b.dueDate || 'z') ? -1 : 1;
    } else if (field === 'dueDate') {
      const da = a.dueDate || '9999';
      const db = b.dueDate || '9999';
      cmp = da < db ? -1 : da > db ? 1 : 0;
    } else if (field === 'project') {
      cmp = a.project.localeCompare(b.project);
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  const items = visibleItems();
  const tbody = document.getElementById('todo-body');
  const empty = document.getElementById('empty-state');

  if (items.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    updateCounts();
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = '';
  items.forEach(item => {
    const tr = document.createElement('tr');
    tr.dataset.id = item.id;
    tr.dataset.priority = item.priority;
    if (item.done) tr.classList.add('is-done');

    tr.innerHTML = `
      <td class="col-project"><button class="project-link" data-project="${escHtml(item.project)}">${escHtml(item.project)}</button></td>
      <td class="col-priority"><span class="badge ${PRIORITY_CLASS[item.priority]}" title="Click to change priority">${PRIORITY_LABEL[item.priority]}</span></td>
      <td class="col-due">${item.dueDate ? `<span class="due-date${isDue(item.dueDate) ? ' overdue' : ''}">${item.dueDate}</span>` : ''}</td>
      <td class="col-todo">
        <span class="todo-text" title="${escHtml(item.subLines && item.subLines.length ? item.subLines.join('\n') : '')}">${renderText(item.text)}</span>
      </td>
      <td class="col-actions">
        ${!item.done ? `<button class="btn-done" title="Mark done" data-id="${item.id}">✓</button><button class="btn-delete" title="Delete" data-id="${item.id}">✕</button>` : ''}
      </td>
    `;

    tr.querySelector('.project-link').addEventListener('click', () => openContextPanel(item.project));

    if (!item.done) {
      tr.querySelector('.badge').addEventListener('click', () => startPriorityEdit(tr, item));
      tr.querySelector('.todo-text').addEventListener('dblclick', () => startEdit(tr, item));
      tr.querySelector('.btn-done').addEventListener('click', () => markDone(item, tr));
      tr.querySelector('.btn-delete').addEventListener('click', () => deleteTodo(item, tr));
    }

    tbody.appendChild(tr);
  });

  updateCounts();
}

function isDue(dateStr) {
  if (!dateStr) return false;
  return dateStr <= new Date().toISOString().slice(0, 10);
}

function updateCounts() {
  const activeTodos = state.todos.filter(t => itemList(t) === state.list);
  const nowCount = activeTodos.filter(t => t.priority === 'now').length;
  const nextCount = activeTodos.filter(t => t.priority === 'next').length;
  document.getElementById('counts').textContent = `${LIST_LABEL[state.list]} · ${nowCount} now · ${nextCount} next`;
  updateTabCounts();
}

function updateTabCounts() {
  const pool = [
    ...state.todos,
    ...(state.filter.priorities.has('done') ? state.done : []),
  ];
  const counts = pool.reduce((acc, item) => {
    const list = itemList(item);
    if (matchesCurrentFilters(item, list)) acc[list] += 1;
    return acc;
  }, { work: 0, personal: 0 });

  document.getElementById('work-tab-count').textContent = counts.work;
  document.getElementById('personal-tab-count').textContent = counts.personal;
}

// ─── Priority click ───────────────────────────────────────────────────────────

function startPriorityEdit(tr, item) {
  const cell = tr.querySelector('.col-priority');
  cell.innerHTML = `<select class="edit-priority">
    <option value="now"${item.priority === 'now' ? ' selected' : ''}>Now</option>
    <option value="next"${item.priority === 'next' ? ' selected' : ''}>Next</option>
    <option value="someday"${item.priority === 'someday' ? ' selected' : ''}>Someday</option>
  </select>`;

  const sel = cell.querySelector('select');
  sel.focus();

  function save() {
    const newPriority = sel.value;
    if (newPriority === item.priority) { render(); return; }
    fetch(`/api/todos/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        priority: newPriority,
        currentPriority: item.priority,
        file: item.file,
        headlineRaw: item.headlineRaw,
        subLines: item.subLines,
        startLine: item.startLine,
        lineCount: item.lineCount,
      }),
    })
    .then(r => r.json())
    .then(data => { if (data.error) showToast(data.error, 'error'); reload(); })
    .catch(e => { showToast(e.message, 'error'); render(); });
  }

  sel.addEventListener('change', save);
  sel.addEventListener('blur', () => render());
  sel.addEventListener('keydown', e => {
    if (e.key === 'Escape') render();
    if (e.key === 'Enter') { e.preventDefault(); save(); }
  });
}

// ─── Edit inline ──────────────────────────────────────────────────────────────

function startEdit(tr, item) {
  const textCell = tr.querySelector('.col-todo');
  const prioCell = tr.querySelector('.col-priority');
  const originalText = item.headlineRaw;

  textCell.innerHTML = `<input class="edit-text" type="text" value="${escHtml(stripAddedDisplay(item.headlineRaw))}">`;
  prioCell.innerHTML = `<select class="edit-priority">
    <option value="now"${item.priority === 'now' ? ' selected' : ''}>Now</option>
    <option value="next"${item.priority === 'next' ? ' selected' : ''}>Next</option>
    <option value="someday"${item.priority === 'someday' ? ' selected' : ''}>Someday</option>
  </select>`;

  const textInput = textCell.querySelector('.edit-text');
  const prioSelect = prioCell.querySelector('.edit-priority');
  textInput.focus();
  textInput.select();

  function save() {
    const newText = textInput.value.trim();
    const newPriority = prioSelect.value;
    if (!newText) { cancel(); return; }

    fetch(`/api/todos/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: newText,
        priority: newPriority,
        currentPriority: item.priority,
        file: item.file,
        headlineRaw: item.headlineRaw,
        subLines: item.subLines,
        startLine: item.startLine,
        lineCount: item.lineCount,
      }),
    })
    .then(r => r.json())
    .then(data => {
      if (data.error) { showToast(data.error, 'error'); cancel(); return; }
      reload();
    })
    .catch(e => { showToast(e.message, 'error'); cancel(); });
  }

  function cancel() { render(); }

  textInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') cancel();
  });
  prioSelect.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') cancel();
  });
  prioSelect.addEventListener('change', () => textInput.focus());
}

function stripAddedDisplay(raw) {
  return raw.replace(/\s*[—–-]\s*added \d{4}-\d{2}-\d{2}$/, '');
}

// ─── Mark done ────────────────────────────────────────────────────────────────

function markDone(item, tr) {
  tr.classList.add('fading');
  fetch(`/api/todos/${item.id}/done`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file: item.file,
      headlineRaw: item.headlineRaw,
      subLines: item.subLines,
      startLine: item.startLine,
      lineCount: item.lineCount,
      project: item.project,
    }),
  })
  .then(r => r.json())
  .then(data => {
    if (data.error) { tr.classList.remove('fading'); showToast(data.error, 'error'); return; }
    reload();
  })
  .catch(e => { tr.classList.remove('fading'); showToast(e.message, 'error'); });
}

// ─── Delete todo ──────────────────────────────────────────────────────────────

function deleteTodo(item, tr) {
  const dialog = document.getElementById('confirm-delete-dialog');
  const okBtn = document.getElementById('confirm-delete-ok');
  const cancelBtn = document.getElementById('confirm-delete-cancel');

  function cleanup() {
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', onCancel);
    dialog.removeEventListener('cancel', onCancel);
  }

  function onOk() {
    cleanup();
    dialog.close();

    const parent = tr.parentNode;
    const next = tr.nextSibling;
    parent.removeChild(tr);
    updateCounts();

    fetch(`/api/todos/${item.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: item.file, headlineRaw: item.headlineRaw }),
    })
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        parent.insertBefore(tr, next);
        updateCounts();
        showToast(data.error, 'error');
      }
    })
    .catch(e => {
      parent.insertBefore(tr, next);
      updateCounts();
      showToast(e.message, 'error');
    });
  }

  function onCancel() {
    cleanup();
    dialog.close();
  }

  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', onCancel);
  dialog.addEventListener('cancel', onCancel);

  dialog.showModal();
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadData() {
  const [todos, projects] = await Promise.all([
    fetch('/api/todos').then(r => r.json()),
    fetch('/api/projects').then(r => r.json()),
  ]);
  state.todos = todos;
  state.projects = projects;

  if (state.filter.priorities.has('done') && state.done.length === 0) {
    state.done = await fetch('/api/done').then(r => r.json());
  }

  updateProjectDropdown();
  render();
}

async function loadDone() {
  if (state.done.length === 0) {
    state.done = await fetch('/api/done').then(r => r.json());
  }
}

function reload() {
  state.done = []; // force fresh load on next toggle
  loadData();
}

function updateProjectDropdown() {
  const sel = document.getElementById('filter-project');
  const current = sel.value;
  const activeProjects = projectsForActiveList();

  if (current !== 'all' && !activeProjects.includes(current)) {
    state.filter.project = 'all';
  }

  sel.innerHTML = `<option value="all">All ${state.list} projects</option>`;
  activeProjects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    if (p === state.filter.project) opt.selected = true;
    sel.appendChild(opt);
  });

  // Also populate new-todo project dropdown
  const newSel = document.getElementById('new-project');
  newSel.innerHTML = '';

  if (state.list === 'personal') {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(generic)';
    newSel.appendChild(opt);
  }

  activeProjects.filter(p => p !== '(generic)').forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    newSel.appendChild(opt);
  });

  if (state.filter.project !== 'all') {
    newSel.value = state.filter.project;
  } else if (newSel.options.length > 0) {
    newSel.selectedIndex = 0;
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer;
function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = type;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3000);
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

document.getElementById('search').addEventListener('input', e => {
  state.filter.search = e.target.value;
  render();
});

document.getElementById('filter-project').addEventListener('change', e => {
  state.filter.project = e.target.value;
  render();
});

document.querySelectorAll('.list-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const list = tab.dataset.list;
    if (state.list === list) return;

    state.list = list;
    state.filter.project = 'all';
    document.querySelectorAll('.list-tab').forEach(t => t.classList.toggle('active', t === tab));

    if (state.subTab === 'todo') {
      updateProjectDropdown();
      render();
    } else if (state.subTab === 'prs') {
      renderPRView();
    } else if (state.subTab === 'code') {
      updateCodeRepoDropdown();
      renderCodeTodos();
    }

    updateSubTabCounts();
  });
});

document.querySelectorAll('.priority-toggles .toggle-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const p = btn.dataset.priority;
    if (state.filter.priorities.has(p)) {
      state.filter.priorities.delete(p);
    } else {
      state.filter.priorities.add(p);
      if (p === 'done') await loadDone();
    }

    if (state.filter.priorities.size === 0) {
      state.filter.priorities = new Set(DEFAULT_VISIBLE_PRIORITIES);
    }

    syncPriorityToggleButtons();
    render();
  });
});

document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const field = btn.dataset.field;
    if (state.sort.field === field) {
      state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sort.field = field;
      state.sort.dir = 'asc';
    }
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  });
});

document.getElementById('add-btn').addEventListener('click', () => {
  document.getElementById('new-todo-panel').classList.toggle('hidden');
  if (!document.getElementById('new-todo-panel').classList.contains('hidden')) {
    // Inherit filter selections as defaults
    if (state.filter.project !== 'all') {
      document.getElementById('new-project').value = state.filter.project;
    }
    if (state.filter.priorities.size === 1) {
      const [priority] = state.filter.priorities;
      if (priority !== 'done') {
        document.getElementById('new-priority').value = priority;
      }
    }
    document.getElementById('new-text').focus();
  }
});

document.getElementById('cancel-new').addEventListener('click', () => {
  document.getElementById('new-todo-panel').classList.add('hidden');
  document.getElementById('new-todo-form').reset();
});

document.getElementById('new-todo-form').addEventListener('submit', e => {
  e.preventDefault();
  const text = document.getElementById('new-text').value.trim();
  const project = document.getElementById('new-project').value;
  const priority = document.getElementById('new-priority').value;

  if (!text) return;

  fetch('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, project, priority }),
  })
  .then(r => r.json())
  .then(data => {
    if (data.error) { showToast(data.error, 'error'); return; }
    document.getElementById('new-todo-panel').classList.add('hidden');
    document.getElementById('new-todo-form').reset();
    reload();
  })
  .catch(e => showToast(e.message, 'error'));
});

// ─── Sub-tab switching ────────────────────────────────────────────────────────

function switchSubTab(subTab) {
  state.subTab = subTab;
  document.querySelectorAll('.sub-tab').forEach(t => t.classList.toggle('active', t.dataset.subtab === subTab));

  const isTodo    = subTab === 'todo';
  const isPrs     = subTab === 'prs';
  const isCode    = subTab === 'code';
  const isMap     = subTab === 'map';
  const isScripts = subTab === 'scripts';

  document.getElementById('toolbar').classList.toggle('hidden', !isTodo);
  document.getElementById('new-todo-panel').classList.add('hidden');
  document.getElementById('pr-view').classList.toggle('hidden', !isPrs);
  document.getElementById('code-view').classList.toggle('hidden', !isCode);
  document.getElementById('map-view').classList.toggle('hidden', !isMap);
  document.getElementById('scripts-view').classList.toggle('hidden', !isScripts);
  document.getElementById('todo-table').classList.toggle('hidden', !isTodo);
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('add-btn').classList.toggle('hidden', !isTodo);

  if (isTodo)    { updateProjectDropdown(); render(); }
  if (isPrs)     renderPRView();
  if (isCode)    { updateCodeRepoDropdown(); if (state.codeTodos.length === 0) loadCodeTodos(); else renderCodeTodos(); }
  if (isMap)     loadProjectsMap();
  if (isScripts) loadScripts();
}

document.querySelectorAll('.sub-tab').forEach(tab => {
  tab.addEventListener('click', () => switchSubTab(tab.dataset.subtab));
});

// ─── Sub-tab counts ───────────────────────────────────────────────────────────

function updateSubTabCounts() {
  const prsCount = visiblePRs().length;
  const codeCount = visibleCodeTodos().length;

  const prsEl = document.getElementById('prs-sub-count');
  if (prsEl && state.prs.length > 0) prsEl.textContent = prsCount;

  const codeEl = document.getElementById('code-sub-count');
  if (codeEl) codeEl.textContent = codeCount;
}

// ─── PR Classification ────────────────────────────────────────────────────────

const WORK_PR_ORGS = new Set(['EyeSeeTea']);

function prListOf(pr) {
  const org = pr.repo.split('/')[0];
  return WORK_PR_ORGS.has(org) ? 'work' : 'personal';
}

function visiblePRs() {
  return state.prs.filter(pr => prListOf(pr) === state.list);
}

// ─── PR View ──────────────────────────────────────────────────────────────────

function renderPRView() {
  const listEl = document.getElementById('pr-list');
  const prs = visiblePRs();

  updateSubTabCounts();

  if (state.prs.length === 0) {
    listEl.innerHTML = '<div class="pr-empty">Loading…</div>';
    return;
  }

  if (prs.length === 0) {
    listEl.innerHTML = '<div class="pr-empty">No PRs waiting for your review ✓</div>';
    return;
  }

  listEl.innerHTML = prs.map(pr => {
    const age = prAge(pr.createdAt);
    const repoShort = pr.repo.split('/').pop();
    return `<a class="pr-row" href="${escHtml(pr.url)}" target="_blank" rel="noopener">
      <span class="pr-repo">${escHtml(repoShort)}</span>
      <span class="pr-title">${escHtml(pr.title)}</span>
      <span class="pr-meta">${escHtml(pr.author)} · ${age}</span>
    </a>`;
  }).join('');
}

function prAge(isoDate) {
  const days = Math.floor((Date.now() - new Date(isoDate)) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

async function loadPRs() {
  try {
    const prs = await fetch('/api/prs-to-review').then(r => r.json());
    if (prs.error) {
      if (state.subTab === 'prs') document.getElementById('pr-list').innerHTML = `<div class="pr-empty pr-error">${escHtml(prs.error)}</div>`;
      return;
    }
    state.prs = prs;
    updateSubTabCounts();
    if (state.subTab === 'prs') renderPRView();
  } catch (e) {
    if (state.subTab === 'prs') document.getElementById('pr-list').innerHTML = `<div class="pr-empty pr-error">${escHtml(e.message)}</div>`;
  }
}

document.getElementById('pr-refresh-btn').addEventListener('click', async () => {
  document.getElementById('prs-sub-count').textContent = '…';
  document.getElementById('pr-list').innerHTML = '<div class="pr-empty">Refreshing…</div>';
  await fetch('/api/prs-to-review/cache', { method: 'DELETE' });
  state.prs = [];
  loadPRs();
});

setInterval(loadPRs, 5 * 60 * 1000);

// ─── Context Panel ────────────────────────────────────────────────────────────

function renderMarkdownBlocks(md) {
  const lines = md.split('\n');
  const out = [];
  let inList = false;
  let inCode = false;
  let codeLines = [];

  let inTable = false;
  let tableRows = [];

  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const flushCode = () => { out.push(`<pre><code>${escHtml(codeLines.join('\n'))}</code></pre>`); codeLines = []; inCode = false; };
  const flushTable = () => {
    if (!inTable) return;
    const [header, ...rows] = tableRows;
    const cells = row => row.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
    let html = '<div class="md-table-wrap"><table><thead><tr>';
    html += cells(header).map(c => `<th>${renderText(c)}</th>`).join('');
    html += '</tr></thead><tbody>';
    const hasSeparator = rows[0] !== undefined && /^\s*\|[\s:|-]+\|?\s*$/.test(rows[0]);
    html += (hasSeparator ? rows.slice(1) : rows)
      .map(r => `<tr>${cells(r).map(c => `<td>${renderText(c)}</td>`).join('')}</tr>`).join('');
    html += '</tbody></table></div>';
    out.push(html);
    tableRows = [];
    inTable = false;
  };

  for (const line of lines) {
    if (inCode) {
      if (line.startsWith('```')) flushCode(); else codeLines.push(line);
      continue;
    }
    if (line.startsWith('```')) { closeList(); flushTable(); inCode = true; continue; }

    if (/^\s*\|/.test(line)) {
      closeList();
      inTable = true;
      tableRows.push(line);
      continue;
    }
    flushTable();

    const hm = /^(#{1,4})\s+(.+)$/.exec(line);
    if (hm) { closeList(); out.push(`<h${hm[1].length}>${renderText(hm[2])}</h${hm[1].length}>`); continue; }

    if (/^---+$/.test(line.trim())) { closeList(); out.push('<hr>'); continue; }

    if (/^[-*]\s/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${renderText(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }

    if (line.trim() === '') { closeList(); continue; }
    closeList();
    out.push(`<p>${renderText(line)}</p>`);
  }

  closeList();
  flushTable();
  if (inCode) flushCode();
  return out.join('\n');
}

async function openContextPanel(project) {
  const panel = document.getElementById('context-panel');
  const overlay = document.getElementById('context-overlay');
  const title = document.getElementById('context-panel-title');
  const body = document.getElementById('context-panel-body');

  title.textContent = project;
  body.innerHTML = '<div class="context-loading">Loading…</div>';
  panel.classList.remove('hidden');
  overlay.classList.remove('hidden');

  try {
    const data = await fetch(`/api/projects/${encodeURIComponent(project)}/context`).then(r => r.json());
    if (data.error) { body.innerHTML = `<p class="context-error">${escHtml(data.error)}</p>`; return; }
    body.innerHTML = renderMarkdownBlocks(data.markdown);
  } catch (e) {
    body.innerHTML = `<p class="context-error">${escHtml(e.message)}</p>`;
  }
}

function closeContextPanel() {
  document.getElementById('context-panel').classList.add('hidden');
  document.getElementById('context-overlay').classList.add('hidden');
}

document.getElementById('context-panel-close').addEventListener('click', closeContextPanel);
document.getElementById('context-overlay').addEventListener('click', closeContextPanel);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeContextPanel(); });

// ─── Map Tab ──────────────────────────────────────────────────────────────────

async function loadProjectsMap() {
  const body = document.getElementById('map-body');
  body.innerHTML = '<div class="pr-empty">Loading…</div>';
  try {
    const data = await fetch('/api/projects-map').then(r => r.json());
    if (data.error) { body.innerHTML = `<div class="pr-empty pr-error">${escHtml(data.error)}</div>`; return; }
    document.getElementById('map-path').textContent = data.path.replace(/^\/Users\/[^/]+/, '~');
    body.innerHTML = renderMarkdownBlocks(data.markdown);
  } catch (e) {
    body.innerHTML = `<div class="pr-empty pr-error">${escHtml(e.message)}</div>`;
  }
}

document.getElementById('map-refresh-btn').addEventListener('click', loadProjectsMap);

// ─── Scripts Tab ──────────────────────────────────────────────────────────────

async function loadScripts() {
  const listEl = document.getElementById('scripts-list');
  listEl.innerHTML = '<div class="pr-empty">Loading…</div>';
  try {
    const scripts = await fetch('/api/scripts').then(r => r.json());
    if (scripts.error) { listEl.innerHTML = `<div class="pr-empty pr-error">${escHtml(scripts.error)}</div>`; return; }
    if (scripts.length === 0) { listEl.innerHTML = '<div class="pr-empty">No scripts found.</div>'; return; }

    listEl.innerHTML = scripts.map(s => `
      <div class="script-item">
        <div class="script-head">
          <span class="script-name">${escHtml(s.name)}</span>
          ${s.executable ? '' : '<span class="script-noexec" title="Not executable">not executable</span>'}
          <span class="script-mtime">${escHtml(String(s.mtime).slice(0, 10))}</span>
        </div>
        <div class="script-desc">${renderMarkdownBlocks(s.description || '_No header comment._')}</div>
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = `<div class="pr-empty pr-error">${escHtml(e.message)}</div>`;
  }
}

document.getElementById('scripts-refresh-btn').addEventListener('click', loadScripts);

// ─── Code Tab ─────────────────────────────────────────────────────────────────

function visibleCodeTodos() {
  const byList = state.codeTodos.filter(t => t.list === state.list);
  return state.codeFilter.repo === 'all' ? byList : byList.filter(t => t.repo === state.codeFilter.repo);
}

function updateCodeRepoDropdown() {
  const repos = [...new Set(state.codeTodos.filter(t => t.list === state.list).map(t => t.repo))].sort();
  const sel = document.getElementById('code-filter-repo');
  const current = sel.value;
  sel.innerHTML = '<option value="all">All repos</option>';
  repos.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r; opt.textContent = r;
    if (r === current) opt.selected = true;
    sel.appendChild(opt);
  });
  if (!repos.includes(state.codeFilter.repo)) state.codeFilter.repo = 'all';
}

function renderCodeTodos() {
  const listEl = document.getElementById('code-list');
  const filtered = visibleCodeTodos();

  updateSubTabCounts();

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="code-empty">No TODO/FIXME items found.</div>';
    return;
  }

  const grouped = filtered.reduce((acc, t) => { (acc[t.repo] = acc[t.repo] || []).push(t); return acc; }, {});

  listEl.innerHTML = Object.entries(grouped).map(([repoName, items]) => `
    <div class="code-repo-group">
      <div class="code-repo-name">${escHtml(repoName)} <span class="code-repo-count">${items.length}</span></div>
      ${items.map(t => `
        <div class="code-item">
          <span class="code-type ${t.type === 'FIXME' ? 'fixme' : 'todo'}">${t.type}</span>
          <span class="code-file">${escHtml(t.file)}:${t.line}</span>
          <span class="code-text">${escHtml(t.text)}</span>
        </div>
      `).join('')}
    </div>
  `).join('');
}

async function loadCodeTodos() {
  const listEl = document.getElementById('code-list');
  listEl.innerHTML = '<div class="code-empty">Scanning repos…</div>';

  try {
    const todos = await fetch('/api/code-todos').then(r => r.json());
    state.codeTodos = todos;
    updateCodeRepoDropdown();
    renderCodeTodos();
  } catch (e) {
    listEl.innerHTML = `<div class="code-empty code-error">${escHtml(e.message)}</div>`;
  }
}

document.getElementById('code-filter-repo').addEventListener('change', e => {
  state.codeFilter.repo = e.target.value;
  renderCodeTodos();
});

document.getElementById('code-refresh-btn').addEventListener('click', loadCodeTodos);

// ─── Boot ─────────────────────────────────────────────────────────────────────

loadData();
loadPRs();
