'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { glob } = require('glob');

const app = express();
const PORT = process.env.PORT || 3333;
const WORKSPACE = path.join(process.env.HOME, '.claude', 'workspace');

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

    const sectionMatch = /^##\s+(Now|Next|Someday)\s*$/i.exec(line);
    if (sectionMatch) {
      const s = sectionMatch[1].toLowerCase();
      currentPriority = s === 'now' ? 'now' : s === 'next' ? 'next' : 'someday';
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

app.listen(PORT, () => {
  console.log(`Mission Control running at http://localhost:${PORT}`);
});
