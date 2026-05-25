// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  todos: [],
  done: [],
  projects: [],
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

// ─── Filtering & sorting ──────────────────────────────────────────────────────

function visibleItems() {
  const { priorities, project, search } = state.filter;
  const searchLow = search.toLowerCase();

  const pool = [
    ...state.todos,
    ...(priorities.has('done') ? state.done : []),
  ];

  return pool.filter(item => {
    if (!priorities.has(item.priority)) return false;
    if (project !== 'all' && item.project !== project) return false;
    if (searchLow && !item.text.toLowerCase().includes(searchLow) &&
        !item.project.toLowerCase().includes(searchLow)) return false;
    return true;
  }).sort((a, b) => {
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
      <td class="col-project">${escHtml(item.project)}</td>
      <td class="col-priority"><span class="badge ${PRIORITY_CLASS[item.priority]}" title="Click to change priority">${PRIORITY_LABEL[item.priority]}</span></td>
      <td class="col-due">${item.dueDate ? `<span class="due-date${isDue(item.dueDate) ? ' overdue' : ''}">${item.dueDate}</span>` : ''}</td>
      <td class="col-todo">
        <span class="todo-text" title="${escHtml(item.subLines && item.subLines.length ? item.subLines.join('\n') : '')}">${renderText(item.text)}</span>
      </td>
      <td class="col-actions">
        ${!item.done ? `<button class="btn-done" title="Mark done" data-id="${item.id}">✓</button>` : ''}
      </td>
    `;

    if (!item.done) {
      tr.querySelector('.badge').addEventListener('click', () => startPriorityEdit(tr, item));
      tr.querySelector('.todo-text').addEventListener('dblclick', () => startEdit(tr, item));
      tr.querySelector('.btn-done').addEventListener('click', () => markDone(item, tr));
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
  const nowCount = state.todos.filter(t => t.priority === 'now').length;
  const nextCount = state.todos.filter(t => t.priority === 'next').length;
  document.getElementById('counts').textContent = `${nowCount} now · ${nextCount} next`;
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
  sel.innerHTML = '<option value="all">All projects</option>';
  state.projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    if (p === current) opt.selected = true;
    sel.appendChild(opt);
  });

  // Also populate new-todo project dropdown
  const newSel = document.getElementById('new-project');
  newSel.innerHTML = '<option value="">(generic)</option>';
  state.projects.filter(p => p !== '(generic)').forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    newSel.appendChild(opt);
  });
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

document.querySelectorAll('.priority-toggles .toggle-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const p = btn.dataset.priority;
    if (state.filter.priorities.has(p)) {
      state.filter.priorities.delete(p);
      btn.classList.remove('active');
    } else {
      state.filter.priorities.add(p);
      btn.classList.add('active');
      if (p === 'done') await loadDone();
    }
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

// ─── Boot ─────────────────────────────────────────────────────────────────────

loadData();
