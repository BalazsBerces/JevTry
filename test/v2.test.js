const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

describe('Tasks API v2', () => {
  let app;
  beforeEach(() => { app = createApp(); });
  const mkTask = (extra = {}) => request(app).post('/tasks').send({ title: 't', ...extra });
  const mkUser = (name = 'Ann') => request(app).post('/users').send({ name });
  const put = (id, body) => request(app).put(`/tasks/${id}`).send(body);

  describe('users', () => {
    test('create and list', async () => {
      const a = await mkUser('Ann');
      const b = await mkUser(' Bob ');
      assert.equal(a.status, 201);
      assert.deepEqual(b.body, { id: 2, name: 'Bob' });
      const list = await request(app).get('/users');
      assert.equal(list.status, 200);
      assert.equal(list.body.length, 2);
    });
    for (const body of [{}, { name: '' }, { name: '  ' }, { name: 3 }, [1]]) {
      test(`rejects ${JSON.stringify(body)}`, async () => {
        assert.equal((await request(app).post('/users').send(body)).status, 400);
      });
    }
    test('invalid and unknown ids', async () => {
      assert.equal((await request(app).delete('/users/abc')).status, 400);
      assert.equal((await request(app).delete('/users/0')).status, 400);
      assert.equal((await request(app).delete('/users/9')).status, 404);
      assert.equal((await request(app).get('/users/x/tasks')).status, 400);
      assert.equal((await request(app).get('/users/9/tasks')).status, 404);
    });
    test('delete user without tasks', async () => {
      await mkUser();
      assert.equal((await request(app).delete('/users/1')).status, 204);
      assert.deepEqual((await request(app).get('/users')).body, []);
    });
    test('delete user with assigned tasks returns 409, succeeds after task removed', async () => {
      await mkUser();
      await mkTask({ assigneeId: 1 });
      assert.equal((await request(app).delete('/users/1')).status, 409);
      await request(app).delete('/tasks/1');
      assert.equal((await request(app).delete('/users/1')).status, 204);
    });
    test('delete user after unassigning', async () => {
      await mkUser();
      await mkTask({ assigneeId: 1 });
      const r = await put(1, { assigneeId: null });
      assert.equal(r.status, 200);
      assert.equal('assigneeId' in r.body, false);
      assert.equal((await request(app).delete('/users/1')).status, 204);
    });
  });

  describe('assignment', () => {
    test('assign and list user tasks', async () => {
      await mkUser(); await mkUser('B');
      await mkTask({ assigneeId: 1 }); await mkTask({ assigneeId: 2 }); await mkTask();
      const res = await request(app).get('/users/1/tasks');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.map((t) => t.id), [1]);
    });
    test('rejects nonexistent or invalid assignee with 400', async () => {
      assert.equal((await mkTask({ assigneeId: 5 })).status, 400);
      assert.equal((await mkTask({ assigneeId: 'x' })).status, 400);
      assert.equal((await mkTask({ assigneeId: -1 })).status, 400);
      await mkTask();
      assert.equal((await put(1, { assigneeId: 7 })).status, 400);
    });
    test('PUT assigns existing user', async () => {
      await mkUser(); await mkTask();
      const r = await put(1, { assigneeId: 1 });
      assert.equal(r.body.assigneeId, 1);
    });
  });

  describe('dependencies', () => {
    test('create with dependencies', async () => {
      await mkTask(); await mkTask();
      const r = await mkTask({ dependencies: [1, 2] });
      assert.equal(r.status, 201);
      assert.deepEqual(r.body.dependencies, [1, 2]);
    });
    test('missing dependency 400', async () => {
      assert.equal((await mkTask({ dependencies: [99] })).status, 400);
      await mkTask();
      assert.equal((await put(1, { dependencies: [99] })).status, 400);
    });
    test('invalid dependency ids / shape 400', async () => {
      for (const d of ['1', [0], [-1], ['a'], [1.5], [null]]) {
        assert.equal((await mkTask({ dependencies: d })).status, 400);
      }
    });
    test('self dependency 400', async () => {
      await mkTask();
      assert.equal((await put(1, { dependencies: [1] })).status, 400);
    });
    test('duplicate dependencies 400', async () => {
      await mkTask();
      assert.equal((await mkTask({ dependencies: [1, 1] })).status, 400);
    });
    test('direct cycle 409', async () => {
      await mkTask(); await mkTask({ dependencies: [1] });
      assert.equal((await put(1, { dependencies: [2] })).status, 409);
    });
    test('transitive cycle 409 at depth 3, task unchanged', async () => {
      await mkTask();
      await mkTask({ dependencies: [1] });
      await mkTask({ dependencies: [2] });
      assert.equal((await put(1, { dependencies: [3] })).status, 409);
      const t = await request(app).get('/tasks');
      assert.equal(t.body[0].dependencies, undefined);
    });
    test('cycle detection on a long chain (500)', async () => {
      await mkTask();
      for (let i = 2; i <= 500; i++) await mkTask({ dependencies: [i - 1] });
      assert.equal((await put(1, { dependencies: [500] })).status, 409);
    });
    test('diamond is not a cycle', async () => {
      await mkTask();
      await mkTask({ dependencies: [1] });
      await mkTask({ dependencies: [1] });
      assert.equal((await mkTask({ dependencies: [2, 3] })).status, 201);
    });
    test('blocked completion 409, then allowed once dependency complete', async () => {
      await mkTask(); await mkTask({ dependencies: [1] });
      assert.equal((await put(2, { completed: true })).status, 409);
      assert.equal((await mkTask({ completed: true, dependencies: [1] })).status, 409);
      assert.equal((await put(1, { completed: true })).status, 200);
      assert.equal((await put(2, { completed: true })).status, 200);
    });
    test('failed update leaves task unchanged', async () => {
      await mkTask(); await mkTask({ dependencies: [1] });
      await put(2, { title: 'new', completed: true });
      const t = (await request(app).get('/tasks')).body[1];
      assert.equal(t.title, 't');
      assert.equal(t.completed, false);
    });
    test('deleting a task removes it from dependencies', async () => {
      await mkTask(); await mkTask({ dependencies: [1] });
      await request(app).delete('/tasks/1');
      const t = (await request(app).get('/tasks')).body[0];
      assert.equal(t.dependencies, undefined);
      assert.equal((await put(2, { completed: true })).status, 200);
    });
  });

  describe('deadlines', () => {
    const past = '2000-01-01T00:00:00Z';
    const future = '2999-01-01T00:00:00.500Z';
    test('rejects invalid dates', async () => {
      for (const d of ['nope', '2030-02-30T00:00:00Z', '2030-01-01', '2030-01-01T00:00:00+02:00',
        '2030-01-01T00:00:00', 5, true, '2030-13-01T00:00:00Z', '2030-01-01T24:00:00Z']) {
        assert.equal((await mkTask({ dueDate: d })).status, 400, String(d));
      }
      await mkTask();
      assert.equal((await put(1, { dueDate: 'bad' })).status, 400);
    });
    test('accepts valid date and clears with null', async () => {
      const r = await mkTask({ dueDate: future });
      assert.equal(r.body.dueDate, future);
      const c = await put(1, { dueDate: null });
      assert.equal('dueDate' in c.body, false);
    });
    test('overdue filter', async () => {
      await mkTask({ dueDate: past });                      // 1 overdue
      await mkTask({ dueDate: future });                    // 2 not yet
      await mkTask();                                       // 3 no date
      await mkTask({ dueDate: past, completed: true });     // 4 complete
      const r = await request(app).get('/tasks?overdue=true');
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.map((t) => t.id), [1]);
      const f = await request(app).get('/tasks?overdue=false');
      assert.deepEqual(f.body.map((t) => t.id), [2, 3, 4]);
      assert.equal((await request(app).get('/tasks')).body.length, 4);
    });
    test('completing a task removes it from overdue', async () => {
      await mkTask({ dueDate: past });
      await put(1, { completed: true });
      assert.deepEqual((await request(app).get('/tasks?overdue=true')).body, []);
    });
    test('invalid overdue value 400', async () => {
      assert.equal((await request(app).get('/tasks?overdue=maybe')).status, 400);
    });
  });
});
