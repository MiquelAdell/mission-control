'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { glob } = require('glob');
const { exec, execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3333;
const WORKSPACE = path.join(process.env.HOME, 'workspace');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Parsing ────────────────────────────────────────────────────────────────

function projectFromPath(filePath) {
  const rel = path.relative(WORKSPACE, filePath);
  // "apps/todo.md" → "apps", "todo.md" → "(generic)", "proposals/x/todo.md" → "proposals/x"
  const withoutFile = rel.replace(/\/(todo|done)\.md$/, '').replace(/^(todo|done)\.md$/, '');
  return withoutFile === '' ? '(generic)' : withoutFile;
}

const DUE_DATE_RE = /\[(\d{4}-\d{2}-\d{2})[^\]]*\]/;
const ADDED_RE = /\s*[—–-]\s*added \d{4}-\d{2}-\d{2}$/;

function extractDueDate(text) {
  const m = DUE_DATE_RE.exec(text);
  return m ? m[1] : null;
}

function stripAdded(text) {
  return text.replace(ADDED_RE, '');
}

function itemId(filePath, startLine, rawText) {
  return crypto.createHash('sha1').update(`${filePath}:${startLine}:${rawText}`).digest('hex').slice(0, 12);
}

function parseTodoFile(filePath) {
  const project = projectFromPath(filePath);
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return []; }

  const lines = content.split('\n');
  const items = [];
  let currentPriority = 'next';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const sectionMatch = /^##\s+(Now|Next)\s*$/i.exec(line);
    if (sectionMatch) {
      const s = sectionMatch[1].toLowerCase();
      currentPriority = s === 'now' ? 'now' : 'next';
      i++;
      continue;
    }

    const todoMatch = /^- \[ \] (.+)$/.exec(line);
    if (todoMatch) {
      const startLine = i;
      const headlineRaw = todoMatch[1];
      const subLines = [];
      i++;
      while (i < lines.length && /^  /.test(lines[i])) {
        subLines.push(lines[i]);
        i++;
      }
      const rawText = [line, ...subLines].join('\n');
      const displayText = stripAdded(headlineRaw);
      const dueDate = extractDueDate(headlineRaw);
      items.push({
        id: itemId(filePath, startLine, rawText),
        project,
        priority: currentPriority,
        text: displayText,
        rawText,
        headlineRaw,
        subLines,
        dueDate,
        done: false,
        file: filePath,
        startLine,
        lineCount: 1 + subLines.length,
      });
      continue;
    }

    i++;
  }

  return items;
}

function parseDoneFile(filePath) {
  const project = projectFromPath(filePath);
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return []; }

  const lines = content.split('\n');
  const items = [];

  lines.forEach((line, i) => {
    const m = /^- \[(\d{4}-\d{2}-\d{2})\] (.+)$/.exec(line);
    if (!m) return;
    const doneDate = m[1];
    const text = m[2];
    items.push({
      id: itemId(filePath, i, line),
      project,
      priority: 'done',
      text,
      rawText: line,
      headlineRaw: text,
      subLines: [],
      dueDate: doneDate,
      done: true,
      file: filePath,
      startLine: i,
      lineCount: 1,
    });
  });

  return items;
}

async function getAllTodoFiles() {
  const patterns = [
    path.join(WORKSPACE, 'todo.md'),
    path.join(WORKSPACE, '*/todo.md'),
    path.join(WORKSPACE, '*/*/todo.md'),
  ];
  const files = new Set();
  for (const p of patterns) {
    const found = await glob(p, { nodir: true });
    found.forEach(f => files.add(f));
  }
  return [...files];
}

async function getAllDoneFiles() {
  const patterns = [
    path.join(WORKSPACE, 'done.md'),
    path.join(WORKSPACE, '*/done.md'),
    path.join(WORKSPACE, '*/*/done.md'),
  ];
  const files = new Set();
  for (const p of patterns) {
    const found = await glob(p, { nodir: true });
    found.forEach(f => files.add(f));
  }
  return [...files];
}

// ─── Auto-link ───────────────────────────────────────────────────────────────

function autoLink(text) {
  // Convert bare URLs not already inside a markdown link (...](url) or [url](
  return text.replace(/(?<![(\[`])https?:\/\/[^\s)\]`]+/g, url => `[${url}](${url})`);
}

// ─── File mutation helpers ────────────────────────────────────────────────────

function readLines(filePath) {
  try { return fs.readFileSync(filePath, 'utf8').split('\n'); } catch { return []; }
}

function writeLines(filePath, lines) {
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function ensureDoneFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '# done\n\n', 'utf8');
  }
}

function todoFileForProject(project) {
  if (project === '(generic)' || project === '') {
    return path.join(WORKSPACE, 'todo.md');
  }
  return path.join(WORKSPACE, project, 'todo.md');
}

function doneFileForProject(project) {
  if (project === '(generic)' || project === '') {
    return path.join(WORKSPACE, 'done.md');
  }
  return path.join(WORKSPACE, project, 'done.md');
}

function removeLinesFromFile(filePath, startLine, lineCount) {
  const lines = readLines(filePath);
  lines.splice(startLine, lineCount);
  writeLines(filePath, lines);
}

const PRIORITY_HEADING = { now: '## Now', next: '## Next', someday: '## Someday' };

function ensureSection(lines, priority) {
  const heading = PRIORITY_HEADING[priority];
  const idx = lines.findIndex(l => l.trim().toLowerCase() === heading.toLowerCase());
  if (idx !== -1) return idx;
  const insertAt = lines.length;
  lines.splice(insertAt, 0, '', heading, '');
  return insertAt + 1;
}

function sectionEnd(lines, headingIdx) {
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) return i;
  }
  return lines.length;
}

function appendToSection(filePath, priority, itemLine) {
  const lines = readLines(filePath);
  const headingIdx = ensureSection(lines, priority);
  const end = sectionEnd(lines, headingIdx);
  let insertAt = end;
  while (insertAt > headingIdx + 1 && lines[insertAt - 1].trim() === '') insertAt--;
  lines.splice(insertAt, 0, itemLine);
  writeLines(filePath, lines);
}

// ─── API routes ──────────────────────────────────────────────────────────────

app.get('/api/todos', async (req, res) => {
  try {
    const files = await getAllTodoFiles();
    res.json(files.flatMap(parseTodoFile));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/done', async (req, res) => {
  try {
    const files = await getAllDoneFiles();
    res.json(files.flatMap(parseDoneFile));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects', async (req, res) => {
  try {
    const files = await getAllTodoFiles();
    const projects = [...new Set(files.map(projectFromPath))].sort();
    res.json(projects);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/todos', (req, res) => {
  try {
    const { project = '', priority = 'next', text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });

    const processed = autoLink(text.trim());
    const today = new Date().toISOString().slice(0, 10);
    const line = `- [ ] **${processed}** — added ${today}`;
    const filePath = todoFileForProject(project);

    if (!fs.existsSync(filePath)) {
      const projectLabel = project || '(generic)';
      fs.writeFileSync(filePath, `# ${projectLabel} — todo\n\n`, 'utf8');
    }

    appendToSection(filePath, priority, line);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/todos/:id', (req, res) => {
  try {
    const { text, priority, currentPriority, file: filePath, headlineRaw, subLines = [], startLine, lineCount } = req.body;
    if (!filePath) return res.status(400).json({ error: 'file required' });

    if (priority !== undefined && priority !== currentPriority) {
      // Priority change: remove from old position, re-insert in new section
      const fresh = parseTodoFile(filePath);
      const item = fresh.find(it => it.headlineRaw === headlineRaw);
      if (!item) return res.status(404).json({ error: 'item not found' });

      removeLinesFromFile(filePath, item.startLine, item.lineCount);

      const newHeadline = text ? `- [ ] ${autoLink(text.trim())}` : `- [ ] ${headlineRaw}`;
      appendToSection(filePath, priority, newHeadline);

      if (item.subLines.length > 0) {
        const freshLines = readLines(filePath);
        const idx = freshLines.lastIndexOf(newHeadline);
        if (idx !== -1) freshLines.splice(idx + 1, 0, ...item.subLines);
        writeLines(filePath, freshLines);
      }
    } else if (text !== undefined) {
      const fresh = parseTodoFile(filePath);
      const item = fresh.find(it => it.headlineRaw === headlineRaw);
      if (!item) return res.status(404).json({ error: 'item not found' });

      const lines = readLines(filePath);
      lines[item.startLine] = `- [ ] ${autoLink(text.trim())}`;
      writeLines(filePath, lines);
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/todos/:id/done', (req, res) => {
  try {
    const { file: filePath, headlineRaw, project } = req.body;
    if (!filePath) return res.status(400).json({ error: 'file required' });

    const fresh = parseTodoFile(filePath);
    const item = fresh.find(it => it.headlineRaw === headlineRaw);
    if (!item) return res.status(404).json({ error: 'item not found' });

    removeLinesFromFile(filePath, item.startLine, item.lineCount);

    const doneFile = doneFileForProject(project);
    ensureDoneFile(doneFile);
    const today = new Date().toISOString().slice(0, 10);
    const cleanText = stripAdded(headlineRaw).replace(/\*\*/g, '');
    const doneLine = `- [${today}] ${cleanText}`;

    const doneLines = readLines(doneFile);
    let insertAt = doneLines.length;
    for (let i = 0; i < doneLines.length; i++) {
      if (doneLines[i].startsWith('- [')) { insertAt = i; break; }
    }
    doneLines.splice(insertAt, 0, doneLine);
    writeLines(doneFile, doneLines);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/todos/:id', (req, res) => {
  try {
    const { file: filePath, headlineRaw } = req.body;
    if (!filePath) return res.status(400).json({ error: 'file required' });

    const fresh = parseTodoFile(filePath);
    const item = fresh.find(it => it.headlineRaw === headlineRaw);
    if (!item) return res.status(404).json({ error: 'item not found' });

    removeLinesFromFile(filePath, item.startLine, item.lineCount);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GitHub PR reviews ────────────────────────────────────────────────────────

const GH_ENV = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}` };
let prReviewCache = { data: null, ts: 0 };
const PR_CACHE_TTL = 5 * 60 * 1000;

app.get('/api/prs-to-review', (req, res) => {
  const now = Date.now();
  if (prReviewCache.data !== null && now - prReviewCache.ts < PR_CACHE_TTL) {
    return res.json(prReviewCache.data);
  }
  const query = 'is:pr review-requested:MiquelAdell -reviewed-by:MiquelAdell is:open';
  exec(`gh api "search/issues?q=${encodeURIComponent(query)}&per_page=30"`, { env: GH_ENV }, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    try {
      const parsed = JSON.parse(stdout);
      const items = (parsed.items || []).map(item => ({
        title: item.title,
        url: item.html_url,
        repo: item.repository_url.replace('https://api.github.com/repos/', ''),
        author: item.user.login,
        createdAt: item.created_at,
      }));
      prReviewCache = { data: items, ts: Date.now() };
      res.json(items);
    } catch (e) {
      res.status(500).json({ error: `Parse error: ${e.message}` });
    }
  });
});

app.delete('/api/prs-to-review/cache', (req, res) => {
  prReviewCache = { data: null, ts: 0 };
  res.json({ ok: true });
});

// ─── Project context ──────────────────────────────────────────────────────────

app.get('/api/projects/:name/context', (req, res) => {
  const name = req.params.name;
  let claudeMdPath = null;

  try {
    const entries = fs.readdirSync(WORKSPACE);
    const match = entries.find(e => e.toLowerCase() === name.toLowerCase());
    if (match) {
      const candidate = path.join(WORKSPACE, match, 'CLAUDE.md');
      if (fs.existsSync(candidate)) claudeMdPath = candidate;
    }
  } catch {}

  if (!claudeMdPath) return res.status(404).json({ error: 'No CLAUDE.md for this project' });

  try {
    const markdown = fs.readFileSync(claudeMdPath, 'utf8');
    res.json({ markdown });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Projects map ─────────────────────────────────────────────────────────────

app.get('/api/projects-map', (req, res) => {
  const mapPath = path.join(WORKSPACE, 'projects-map.md');
  try {
    const markdown = fs.readFileSync(mapPath, 'utf8');
    res.json({ markdown, path: mapPath, mtime: fs.statSync(mapPath).mtime });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Helper scripts ───────────────────────────────────────────────────────────

const SCRIPTS_DIR = path.join(process.env.HOME, '.claude', 'scripts');

function scriptDescription(filePath) {
  // Contiguous comment block right after the shebang, "#" lines as paragraph breaks
  let lines;
  try { lines = fs.readFileSync(filePath, 'utf8').split('\n'); } catch { return ''; }
  const body = lines[0] && lines[0].startsWith('#!') ? lines.slice(1) : lines;
  const desc = [];
  for (const line of body) {
    const m = /^#\s?(.*)$/.exec(line);
    if (!m) break;
    desc.push(m[1]);
  }
  return desc.join('\n').trim();
}

app.get('/api/scripts', (req, res) => {
  try {
    const names = fs.readdirSync(SCRIPTS_DIR)
      .filter(f => f.endsWith('.sh'))
      .sort();
    const scripts = names.map(name => {
      const filePath = path.join(SCRIPTS_DIR, name);
      const stat = fs.statSync(filePath);
      return {
        name,
        path: filePath,
        description: scriptDescription(filePath),
        executable: (stat.mode & 0o111) !== 0,
        mtime: stat.mtime,
      };
    });
    res.json(scripts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Code TODOs ───────────────────────────────────────────────────────────────

app.get('/api/code-todos', (req, res) => {
  let repos = [];
  try {
    const configPath = path.join(__dirname, 'repos.json');
    repos = JSON.parse(fs.readFileSync(configPath, 'utf8')).repos || [];
  } catch {
    return res.json([]);
  }

  const results = [];

  for (const repo of repos) {
    const repoPath = repo.path.replace(/^~/, process.env.HOME || '');
    if (!fs.existsSync(repoPath)) continue;

    try {
      const output = execSync(
        `grep -rn -E "(//|#)\\s*(TODO|FIXME):" "${repoPath}" ` +
        `--include="*.js" --include="*.ts" --include="*.tsx" --include="*.jsx" --include="*.py" ` +
        `--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build --exclude-dir=.git ` +
        `2>/dev/null || true`,
        { maxBuffer: 4 * 1024 * 1024 }
      ).toString();

      output.split('\n').filter(Boolean).forEach(line => {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) return;
        const afterFile = line.slice(colonIdx + 1);
        const lineNumColon = afterFile.indexOf(':');
        if (lineNumColon === -1) return;

        const filePath = line.slice(0, colonIdx);
        const lineNum = parseInt(afterFile.slice(0, lineNumColon), 10);
        const content = afterFile.slice(lineNumColon + 1);

        const typeMatch = /(TODO|FIXME)/i.exec(content);
        if (!typeMatch) return;
        const type = typeMatch[1].toUpperCase();
        const text = content.replace(/.*?(TODO|FIXME)\s*:?\s*/i, '').trim() || '(no description)';
        const relFile = path.relative(repoPath, filePath);

        results.push({ repo: repo.name, list: repo.list || 'work', file: relFile, line: lineNum, type, text });
      });
    } catch {}
  }

  res.json(results);
});

// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Mission Control running at http://localhost:${PORT}`);
});
