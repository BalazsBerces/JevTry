const express = require('express');

function createApp() {
  const app = express();
  app.use(express.json());

  const tasks = [];
  let nextId = 1;

  const parseId = (raw) => (/^[1-9]\d*$/.test(raw) ? Number(raw) : null);
  const isObject = (b) => b !== null && typeof b === 'object' && !Array.isArray(b);

  app.get('/tasks', (req, res) => res.status(200).json(tasks));

  app.post('/tasks', (req, res) => {
    const body = req.body;
    if (!isObject(body)) return res.status(400).json({ error: 'Body must be a JSON object' });
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      return res.status(400).json({ error: 'title must be a non-empty string' });
    }
    if (body.completed !== undefined && typeof body.completed !== 'boolean') {
      return res.status(400).json({ error: 'completed must be a boolean' });
    }
    const task = { id: nextId++, title: body.title.trim(), completed: body.completed === true };
    tasks.push(task);
    res.status(201).json(task);
  });

  app.put('/tasks/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });
    const body = req.body;
    if (!isObject(body)) return res.status(400).json({ error: 'Body must be a JSON object' });
    if (body.title === undefined && body.completed === undefined) {
      return res.status(400).json({ error: 'Provide title and/or completed' });
    }
    if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim() === '')) {
      return res.status(400).json({ error: 'title must be a non-empty string' });
    }
    if (body.completed !== undefined && typeof body.completed !== 'boolean') {
      return res.status(400).json({ error: 'completed must be a boolean' });
    }
    const task = tasks.find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (body.title !== undefined) task.title = body.title.trim();
    if (body.completed !== undefined) task.completed = body.completed;
    res.status(200).json(task);
  });

  app.delete('/tasks/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Task not found' });
    tasks.splice(idx, 1);
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
