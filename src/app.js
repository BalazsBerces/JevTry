const express = require('express');

const DUE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/;

// Returns the normalized ISO string for a valid UTC timestamp, or null.
function parseDueDate(value) {
  if (typeof value !== 'string') return null;
  const m = DUE_DATE_RE.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const ms = m[7] ? Number(m[7].slice(1).padEnd(3, '0')) : 0;
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms));
  // Reject out-of-range components (e.g. Feb 30, hour 24) that Date.UTC would roll over.
  if (
    date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d ||
    date.getUTCHours() !== h || date.getUTCMinutes() !== mi || date.getUTCSeconds() !== s
  ) return null;
  return date.toISOString();
}

function createApp({ now = () => Date.now() } = {}) {
  const app = express();
  app.use(express.json());

  const tasks = new Map();
  const users = new Map();
  let nextId = 1;
  let nextUserId = 1;

  const parseId = (raw) => (/^[1-9]\d*$/.test(raw) ? Number(raw) : null);
  const isObject = (b) => b !== null && typeof b === 'object' && !Array.isArray(b);
  const isPositiveInt = (v) => Number.isInteger(v) && v > 0;
  const fail = (status, error) => ({ status, error });

  const isOverdue = (t) => !t.completed && t.dueDate !== undefined && Date.parse(t.dueDate) < now();

  // Shape/type validation of the optional V2 fields; no lookups. Returns an error or null.
  function validateExtraFields(body) {
    if (body.assigneeId !== undefined && body.assigneeId !== null && !isPositiveInt(body.assigneeId)) {
      return fail(400, 'assigneeId must be a positive integer or null');
    }
    if (body.dependencies !== undefined) {
      if (!Array.isArray(body.dependencies) || !body.dependencies.every(isPositiveInt)) {
        return fail(400, 'dependencies must be an array of positive integer task ids');
      }
      if (new Set(body.dependencies).size !== body.dependencies.length) {
        return fail(400, 'dependencies must not contain duplicates');
      }
    }
    if (body.dueDate !== undefined && body.dueDate !== null && parseDueDate(body.dueDate) === null) {
      return fail(400, 'dueDate must be a valid ISO 8601 UTC timestamp (YYYY-MM-DDTHH:mm:ss[.sss]Z)');
    }
    return null;
  }

  // True if targetId is reachable from any of startIds by following dependency edges.
  function reaches(startIds, targetId) {
    const stack = [...startIds];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (cur === targetId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const t = tasks.get(cur);
      if (t && t.dependencies) stack.push(...t.dependencies);
    }
    return false;
  }

  // Referential checks against current state. selfId is null for a task being created.
  function validateReferences(body, selfId) {
    if (isPositiveInt(body.assigneeId) && !users.has(body.assigneeId)) {
      return fail(400, `User ${body.assigneeId} does not exist`);
    }
    if (body.dependencies !== undefined) {
      if (selfId !== null && body.dependencies.includes(selfId)) {
        return fail(400, 'A task cannot depend on itself');
      }
      const missing = body.dependencies.filter((d) => !tasks.has(d));
      if (missing.length) return fail(400, `Dependency task(s) not found: ${missing.join(', ')}`);
      if (selfId !== null && reaches(body.dependencies, selfId)) {
        return fail(409, 'Dependencies would create a circular dependency');
      }
    }
    return null;
  }

  function applyExtraFields(task, body) {
    if (body.assigneeId !== undefined) {
      if (body.assigneeId === null) delete task.assigneeId;
      else task.assigneeId = body.assigneeId;
    }
    if (body.dependencies !== undefined) {
      if (body.dependencies.length === 0) delete task.dependencies;
      else task.dependencies = [...body.dependencies];
    }
    if (body.dueDate !== undefined) {
      if (body.dueDate === null) delete task.dueDate;
      else task.dueDate = parseDueDate(body.dueDate);
    }
  }

  const incompleteDependencies = (deps = []) => deps.filter((d) => !tasks.get(d).completed);

  const send = (res, err) => res.status(err.status).json({ error: err.error });

  app.get('/tasks', (req, res) => {
    const { overdue } = req.query;
    const all = [...tasks.values()];
    if (overdue === undefined) return res.status(200).json(all);
    if (overdue === 'true') return res.status(200).json(all.filter(isOverdue));
    if (overdue === 'false') return res.status(200).json(all.filter((t) => !isOverdue(t)));
    res.status(400).json({ error: 'overdue must be "true" or "false"' });
  });

  app.post('/tasks', (req, res) => {
    const body = req.body;
    if (!isObject(body)) return res.status(400).json({ error: 'Body must be a JSON object' });
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      return res.status(400).json({ error: 'title must be a non-empty string' });
    }
    if (body.completed !== undefined && typeof body.completed !== 'boolean') {
      return res.status(400).json({ error: 'completed must be a boolean' });
    }
    const err = validateExtraFields(body) || validateReferences(body, null);
    if (err) return send(res, err);
    if (body.completed === true && incompleteDependencies(body.dependencies).length) {
      return res.status(409).json({ error: 'Cannot complete a task while dependencies are incomplete' });
    }
    const task = { id: nextId++, title: body.title.trim(), completed: body.completed === true };
    applyExtraFields(task, body);
    tasks.set(task.id, task);
    res.status(201).json(task);
  });

  app.put('/tasks/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });
    const body = req.body;
    if (!isObject(body)) return res.status(400).json({ error: 'Body must be a JSON object' });
    const updatable = ['title', 'completed', 'assigneeId', 'dependencies', 'dueDate'];
    if (updatable.every((k) => body[k] === undefined)) {
      return res.status(400).json({ error: `Provide at least one of: ${updatable.join(', ')}` });
    }
    if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim() === '')) {
      return res.status(400).json({ error: 'title must be a non-empty string' });
    }
    if (body.completed !== undefined && typeof body.completed !== 'boolean') {
      return res.status(400).json({ error: 'completed must be a boolean' });
    }
    const shapeErr = validateExtraFields(body);
    if (shapeErr) return send(res, shapeErr);
    const task = tasks.get(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const refErr = validateReferences(body, id);
    if (refErr) return send(res, refErr);
    const willBeCompleted = body.completed !== undefined ? body.completed : task.completed;
    const finalDeps = body.dependencies !== undefined ? body.dependencies : task.dependencies;
    if (willBeCompleted && incompleteDependencies(finalDeps).length) {
      return res.status(409).json({ error: 'Cannot complete a task while dependencies are incomplete' });
    }
    if (body.title !== undefined) task.title = body.title.trim();
    if (body.completed !== undefined) task.completed = body.completed;
    applyExtraFields(task, body);
    res.status(200).json(task);
  });

  app.delete('/tasks/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });
    if (!tasks.has(id)) return res.status(404).json({ error: 'Task not found' });
    const dependents = [...tasks.values()].filter((t) => t.dependencies && t.dependencies.includes(id));
    if (dependents.length) {
      return res.status(409).json({
        error: `Task is a dependency of task(s): ${dependents.map((t) => t.id).join(', ')}`,
      });
    }
    tasks.delete(id);
    res.status(204).end();
  });

  app.get('/users', (req, res) => res.status(200).json([...users.values()]));

  app.post('/users', (req, res) => {
    const body = req.body;
    if (!isObject(body)) return res.status(400).json({ error: 'Body must be a JSON object' });
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    const user = { id: nextUserId++, name: body.name.trim() };
    users.set(user.id, user);
    res.status(201).json(user);
  });

  app.get('/users/:id/tasks', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });
    if (!users.has(id)) return res.status(404).json({ error: 'User not found' });
    res.status(200).json([...tasks.values()].filter((t) => t.assigneeId === id));
  });

  app.delete('/users/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });
    if (!users.has(id)) return res.status(404).json({ error: 'User not found' });
    if ([...tasks.values()].some((t) => t.assigneeId === id)) {
      return res.status(409).json({ error: 'User has assigned tasks' });
    }
    users.delete(id);
    res.status(204).end();
  });

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 400 && status < 500) {
      const msg = err.type === 'entity.parse.failed' ? 'Malformed JSON' : 'Bad request';
      return res.status(status).json({ error: msg });
    }
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
