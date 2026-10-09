const express = require('express');

function createApp() {
  const app = express();
  app.use(express.json());

  const tasks = [];
  let nextId = 1;
  const users = [];
  let nextUserId = 1;

  const parseId = (raw) => (/^[1-9]\d*$/.test(raw) ? Number(raw) : null);
  const isObject = (b) => b !== null && typeof b === 'object' && !Array.isArray(b);
  const isPosInt = (v) => Number.isInteger(v) && v > 0;
  const findTask = (id) => tasks.find((t) => t.id === id);

  const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?Z$/;
  const validDueDate = (v) => {
    if (typeof v !== 'string') return false;
    const m = ISO_UTC.exec(v);
    if (!m) return false;
    const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
    if (h > 23 || mi > 59 || se > 59) return false;
    const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  };

  // Iterative DFS (no recursion limit): is `target` among the transitive dependencies of `starts`?
  const reaches = (starts, target) => {
    const seen = new Set();
    const stack = [...starts];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === target) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const t = findTask(cur);
      if (t && t.dependencies) stack.push(...t.dependencies);
    }
    return false;
  };

  // Returns { error: [status, msg] } or { value } holding the validated optional fields present in body.
  const validateExtras = (body, selfId) => {
    const out = {};
    if (body.assigneeId !== undefined) {
      if (body.assigneeId !== null) {
        if (!isPosInt(body.assigneeId)) return { error: [400, 'assigneeId must be a positive integer'] };
        if (!users.some((u) => u.id === body.assigneeId)) {
          return { error: [400, 'assigneeId does not reference an existing user'] };
        }
      }
      out.assigneeId = body.assigneeId;
    }
    if (body.dueDate !== undefined) {
      if (body.dueDate !== null && !validDueDate(body.dueDate)) {
        return { error: [400, 'dueDate must be an ISO 8601 UTC timestamp (e.g. 2030-01-01T00:00:00Z)'] };
      }
      out.dueDate = body.dueDate;
    }
    if (body.dependencies !== undefined) {
      const deps = body.dependencies;
      if (!Array.isArray(deps) || !deps.every(isPosInt)) {
        return { error: [400, 'dependencies must be an array of positive integer task ids'] };
      }
      if (new Set(deps).size !== deps.length) return { error: [400, 'dependencies must not contain duplicates'] };
      if (selfId !== undefined && deps.includes(selfId)) return { error: [400, 'A task cannot depend on itself'] };
      if (!deps.every((d) => findTask(d))) return { error: [400, 'dependencies must reference existing tasks'] };
      if (selfId !== undefined && reaches(deps, selfId)) return { error: [409, 'Circular dependency detected'] };
      out.dependencies = deps.slice();
    }
    return { value: out };
  };

  const applyExtras = (task, extras) => {
    for (const k of ['assigneeId', 'dueDate']) {
      if (k in extras) {
        if (extras[k] === null) delete task[k];
        else task[k] = extras[k];
      }
    }
    if ('dependencies' in extras) {
      if (extras.dependencies.length === 0) delete task.dependencies;
      else task.dependencies = extras.dependencies;
    }
  };

  const hasIncompleteDep = (task) => (task.dependencies || []).some((d) => {
    const dt = findTask(d);
    return dt && !dt.completed;
  });

  const isOverdue = (t, now) => !t.completed && t.dueDate !== undefined && Date.parse(t.dueDate) < now;

  app.get('/tasks', (req, res) => {
    const { overdue } = req.query;
    if (overdue === undefined) return res.status(200).json(tasks);
    if (overdue !== 'true' && overdue !== 'false') {
      return res.status(400).json({ error: 'overdue must be true or false' });
    }
    const now = Date.now();
    res.status(200).json(tasks.filter((t) => isOverdue(t, now) === (overdue === 'true')));
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
    const r = validateExtras(body);
    if (r.error) return res.status(r.error[0]).json({ error: r.error[1] });
    const task = { id: nextId, title: body.title.trim(), completed: body.completed === true };
    applyExtras(task, r.value);
    if (task.completed && hasIncompleteDep(task)) {
      return res.status(409).json({ error: 'Cannot complete a task with incomplete dependencies' });
    }
    nextId++;
    tasks.push(task);
    res.status(201).json(task);
  });

  app.put('/tasks/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });
    const body = req.body;
    if (!isObject(body)) return res.status(400).json({ error: 'Body must be a JSON object' });
    if (['title', 'completed', 'assigneeId', 'dueDate', 'dependencies'].every((k) => body[k] === undefined)) {
      return res.status(400).json({ error: 'Provide title and/or completed (or assigneeId, dueDate, dependencies)' });
    }
    if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim() === '')) {
      return res.status(400).json({ error: 'title must be a non-empty string' });
    }
    if (body.completed !== undefined && typeof body.completed !== 'boolean') {
      return res.status(400).json({ error: 'completed must be a boolean' });
    }
    const task = findTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const r = validateExtras(body, id);
    if (r.error) return res.status(r.error[0]).json({ error: r.error[1] });
    const candidate = { ...task };
    applyExtras(candidate, r.value);
    if (body.completed !== undefined) candidate.completed = body.completed;
    if (candidate.completed && hasIncompleteDep(candidate)) {
      return res.status(409).json({ error: 'Cannot complete a task with incomplete dependencies' });
    }
    if (body.title !== undefined) candidate.title = body.title.trim();
    Object.keys(task).forEach((k) => delete task[k]);
    Object.assign(task, candidate);
    res.status(200).json(task);
  });

  app.delete('/tasks/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Task not found' });
    tasks.splice(idx, 1);
    // Remove dangling references from other tasks' dependencies.
    for (const t of tasks) {
      if (t.dependencies && t.dependencies.includes(id)) {
        t.dependencies = t.dependencies.filter((d) => d !== id);
        if (t.dependencies.length === 0) delete t.dependencies;
      }
    }
    res.status(204).end();
  });

  app.post('/users', (req, res) => {
    const body = req.body;
    if (!isObject(body)) return res.status(400).json({ error: 'Body must be a JSON object' });
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    const user = { id: nextUserId++, name: body.name.trim() };
    users.push(user);
    res.status(201).json(user);
  });

  app.get('/users', (req, res) => res.status(200).json(users));

  app.get('/users/:id/tasks', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });
    if (!users.some((u) => u.id === id)) return res.status(404).json({ error: 'User not found' });
    res.status(200).json(tasks.filter((t) => t.assigneeId === id));
  });

  app.delete('/users/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });
    if (tasks.some((t) => t.assigneeId === id)) {
      return res.status(409).json({ error: 'User has assigned tasks' });
    }
    users.splice(idx, 1);
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
