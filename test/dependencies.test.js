const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

describe('Task dependencies', () => {
  let app;
  beforeEach(() => { app = createApp(); });

  const createTask = (body = {}) => request(app).post('/tasks').send({ title: 't', ...body });
  const update = (id, body) => request(app).put(`/tasks/${id}`).send(body);

  test('task can be created with existing dependencies', async () => {
    await createTask();
    await createTask();
    const res = await createTask({ dependencies: [1, 2] });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.dependencies, [1, 2]);
  });

  test('empty dependencies array is accepted and omitted from the task', async () => {
    const res = await createTask({ dependencies: [] });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { id: 1, title: 't', completed: false });
  });

  test('missing dependency is rejected with 400 on create', async () => {
    await createTask();
    const res = await createTask({ dependencies: [1, 99] });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /99/);
    assert.equal((await request(app).get('/tasks')).body.length, 1);
  });

  test('dependency on a deleted task is rejected', async () => {
    await createTask();
    await request(app).delete('/tasks/1');
    assert.equal((await createTask({ dependencies: [1] })).status, 400);
  });

  test('missing dependency is rejected with 400 on update', async () => {
    await createTask();
    assert.equal((await update(1, { dependencies: [5] })).status, 400);
  });

  test('duplicate dependencies are rejected with 400', async () => {
    await createTask();
    assert.equal((await createTask({ dependencies: [1, 1] })).status, 400);
    await createTask();
    assert.equal((await update(2, { dependencies: [1, 1] })).status, 400);
  });

  test('self-dependency is rejected with 400', async () => {
    await createTask();
    const res = await update(1, { dependencies: [1] });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /itself/);
  });

  for (const [name, deps] of [
    ['non-array', 1],
    ['string array', ['1']],
    ['zero id', [0]],
    ['negative id', [-2]],
    ['fractional id', [1.5]],
    ['null element', [null]],
    ['object', { 0: 1 }],
  ]) {
    test(`invalid dependencies (${name}) are rejected with 400`, async () => {
      await createTask();
      assert.equal((await createTask({ dependencies: deps })).status, 400);
      assert.equal((await update(1, { dependencies: deps })).status, 400);
    });
  }

  test('PUT dependencies on unknown task returns 404', async () => {
    await createTask();
    assert.equal((await update(9, { dependencies: [1] })).status, 404);
  });

  test('direct cycle (A -> B -> A) is rejected with 409', async () => {
    await createTask();
    await createTask({ dependencies: [1] });
    const res = await update(1, { dependencies: [2] });
    assert.equal(res.status, 409);
    assert.equal((await request(app).get('/tasks')).body[0].dependencies, undefined);
  });

  test('transitive cycle (A -> B -> C -> A) is rejected with 409', async () => {
    await createTask(); // 1
    await createTask({ dependencies: [1] }); // 2 -> 1
    await createTask({ dependencies: [2] }); // 3 -> 2
    assert.equal((await update(1, { dependencies: [3] })).status, 409);
  });

  test('cycle through a branching graph is detected', async () => {
    await createTask(); // 1
    await createTask(); // 2
    await createTask({ dependencies: [1] }); // 3 -> 1
    await createTask({ dependencies: [2, 3] }); // 4 -> 2, 3
    assert.equal((await update(1, { dependencies: [2, 4] })).status, 409);
    assert.equal((await update(1, { dependencies: [2] })).status, 200);
  });

  test('cycle detection works for long chains', async () => {
    const depth = 500;
    await createTask();
    for (let i = 2; i <= depth; i++) await createTask({ dependencies: [i - 1] });
    assert.equal((await update(1, { dependencies: [depth] })).status, 409);
  });

  test('diamond (shared dependency) is not a cycle', async () => {
    await createTask(); // 1
    await createTask({ dependencies: [1] }); // 2
    await createTask({ dependencies: [1] }); // 3
    const res = await createTask({ dependencies: [2, 3] });
    assert.equal(res.status, 201);
  });

  test('replacing dependencies with a non-cyclic set succeeds; [] clears them', async () => {
    await createTask();
    await createTask();
    await createTask({ dependencies: [1] });
    let res = await update(3, { dependencies: [2] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.dependencies, [2]);
    res = await update(3, { dependencies: [] });
    assert.equal(res.status, 200);
    assert.equal(res.body.dependencies, undefined);
  });

  test('completing a task with an incomplete dependency returns 409', async () => {
    await createTask();
    await createTask({ dependencies: [1] });
    const res = await update(2, { completed: true });
    assert.equal(res.status, 409);
    assert.equal((await request(app).get('/tasks')).body[1].completed, false);
  });

  test('completion is blocked while any one of several dependencies is incomplete', async () => {
    await createTask();
    await createTask();
    await createTask({ dependencies: [1, 2] });
    await update(1, { completed: true });
    assert.equal((await update(3, { completed: true })).status, 409);
    await update(2, { completed: true });
    assert.equal((await update(3, { completed: true })).status, 200);
  });

  test('creating an already-completed task with incomplete dependencies returns 409', async () => {
    await createTask();
    assert.equal((await createTask({ completed: true, dependencies: [1] })).status, 409);
    await update(1, { completed: true });
    assert.equal((await createTask({ completed: true, dependencies: [1] })).status, 201);
  });

  test('adding an incomplete dependency to a completed task returns 409', async () => {
    await createTask();
    await createTask({ completed: true });
    assert.equal((await update(2, { dependencies: [1] })).status, 409);
  });

  test('completion and dependency change in one request are validated together', async () => {
    await createTask(); // incomplete
    await createTask({ completed: true });
    await createTask({ dependencies: [1] });
    assert.equal((await update(3, { completed: true, dependencies: [2] })).status, 200);
  });

  test('un-completing a task with incomplete dependencies is allowed', async () => {
    await createTask({ completed: true });
    await createTask({ completed: true, dependencies: [1] });
    assert.equal((await update(1, { completed: false })).status, 200);
    assert.equal((await update(2, { completed: false })).status, 200);
  });

  test('deleting a task that others depend on returns 409', async () => {
    await createTask();
    await createTask({ dependencies: [1] });
    const res = await request(app).delete('/tasks/1');
    assert.equal(res.status, 409);
    await update(2, { dependencies: [] });
    assert.equal((await request(app).delete('/tasks/1')).status, 204);
  });
});
