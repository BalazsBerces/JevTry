const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

describe('Users and task ownership', () => {
  let app;
  beforeEach(() => { app = createApp(); });

  const createUser = (name = 'Ann') => request(app).post('/users').send({ name });
  const createTask = (body) => request(app).post('/tasks').send({ title: 't', ...body });

  test('GET /users returns empty list initially', async () => {
    const res = await request(app).get('/users');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  test('POST /users creates a user with trimmed name', async () => {
    const res = await createUser('  Ann ');
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { id: 1, name: 'Ann' });
    assert.deepEqual((await request(app).get('/users')).body, [{ id: 1, name: 'Ann' }]);
  });

  test('user ids are unique positive integers and not reused', async () => {
    const a = await createUser('a');
    const b = await createUser('b');
    assert.ok(Number.isInteger(a.body.id) && a.body.id > 0);
    assert.notEqual(a.body.id, b.body.id);
    await request(app).delete(`/users/${b.body.id}`);
    const c = await createUser('c');
    assert.ok(![a.body.id, b.body.id].includes(c.body.id));
  });

  for (const [name, body] of [
    ['missing name', {}],
    ['empty name', { name: '' }],
    ['blank name', { name: '  ' }],
    ['non-string name', { name: 3 }],
    ['array body', ['x']],
  ]) {
    test(`POST /users rejects ${name}`, async () => {
      const res = await request(app).post('/users').send(body);
      assert.equal(res.status, 400);
      assert.ok(res.body.error);
    });
  }

  test('POST /users rejects malformed JSON', async () => {
    const res = await request(app).post('/users').set('Content-Type', 'application/json').send('{"name":');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Malformed JSON');
  });

  test('task can be created with an existing assignee', async () => {
    await createUser();
    const res = await createTask({ assigneeId: 1 });
    assert.equal(res.status, 201);
    assert.equal(res.body.assigneeId, 1);
  });

  test('task with nonexistent assignee is rejected with 400', async () => {
    const res = await createTask({ assigneeId: 42 });
    assert.equal(res.status, 400);
    assert.deepEqual((await request(app).get('/tasks')).body, []);
  });

  for (const bad of [0, -1, 1.5, '1', true, {}]) {
    test(`invalid assigneeId ${JSON.stringify(bad)} is rejected with 400`, async () => {
      await createUser();
      assert.equal((await createTask({ assigneeId: bad })).status, 400);
    });
  }

  test('PUT can assign, reassign and unassign a task', async () => {
    await createUser('a');
    await createUser('b');
    await createTask();
    let res = await request(app).put('/tasks/1').send({ assigneeId: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.assigneeId, 1);
    res = await request(app).put('/tasks/1').send({ assigneeId: 2 });
    assert.equal(res.body.assigneeId, 2);
    res = await request(app).put('/tasks/1').send({ assigneeId: null });
    assert.equal(res.status, 200);
    assert.equal(res.body.assigneeId, undefined);
  });

  test('PUT with nonexistent assignee is rejected with 400 and leaves task unchanged', async () => {
    await createUser();
    await createTask({ assigneeId: 1 });
    const res = await request(app).put('/tasks/1').send({ assigneeId: 9, title: 'changed' });
    assert.equal(res.status, 400);
    const [task] = (await request(app).get('/tasks')).body;
    assert.equal(task.assigneeId, 1);
    assert.equal(task.title, 't');
  });

  test('GET /users/:id/tasks returns only tasks assigned to that user', async () => {
    await createUser('a');
    await createUser('b');
    await createTask({ title: 'a1', assigneeId: 1 });
    await createTask({ title: 'b1', assigneeId: 2 });
    await createTask({ title: 'a2', assigneeId: 1 });
    await createTask({ title: 'none' });
    const res = await request(app).get('/users/1/tasks');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map((t) => t.title), ['a1', 'a2']);
    assert.deepEqual((await request(app).get('/users/2/tasks')).body.map((t) => t.title), ['b1']);
  });

  test('GET /users/:id/tasks returns empty list for user without tasks', async () => {
    await createUser();
    const res = await request(app).get('/users/1/tasks');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  test('GET /users/:id/tasks returns 404 for unknown user', async () => {
    assert.equal((await request(app).get('/users/7/tasks')).status, 404);
  });

  for (const id of ['abc', '0', '-1', '1.5']) {
    test(`user endpoints reject invalid id "${id}" with 400`, async () => {
      assert.equal((await request(app).get(`/users/${id}/tasks`)).status, 400);
      assert.equal((await request(app).delete(`/users/${id}`)).status, 400);
    });
  }

  test('DELETE /users/:id removes a user without tasks', async () => {
    await createUser();
    const res = await request(app).delete('/users/1');
    assert.equal(res.status, 204);
    assert.deepEqual((await request(app).get('/users')).body, []);
  });

  test('DELETE /users/:id returns 404 for unknown user', async () => {
    assert.equal((await request(app).delete('/users/3')).status, 404);
  });

  test('DELETE /users/:id returns 409 while tasks are assigned', async () => {
    await createUser();
    await createTask({ assigneeId: 1 });
    const res = await request(app).delete('/users/1');
    assert.equal(res.status, 409);
    assert.ok(res.body.error);
    assert.equal((await request(app).get('/users')).body.length, 1);
  });

  test('completed assigned tasks still block user deletion', async () => {
    await createUser();
    await createTask({ assigneeId: 1, completed: true });
    assert.equal((await request(app).delete('/users/1')).status, 409);
  });

  test('user can be deleted after tasks are unassigned or deleted', async () => {
    await createUser();
    await createTask({ assigneeId: 1 });
    await createTask({ assigneeId: 1 });
    await request(app).put('/tasks/1').send({ assigneeId: null });
    assert.equal((await request(app).delete('/users/1')).status, 409);
    await request(app).delete('/tasks/2');
    assert.equal((await request(app).delete('/users/1')).status, 204);
  });

  test('cannot assign a task to a deleted user', async () => {
    await createUser();
    await request(app).delete('/users/1');
    assert.equal((await createTask({ assigneeId: 1 })).status, 400);
  });
});
