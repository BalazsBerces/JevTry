const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

describe('Tasks API', () => {
  let app;
  beforeEach(() => { app = createApp(); });

  const create = (title = 'a') => request(app).post('/tasks').send({ title });

  test('GET /tasks returns empty list initially', async () => {
    const res = await request(app).get('/tasks');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  test('POST creates task with completed=false', async () => {
    const res = await create('  Buy milk ');
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { id: 1, title: 'Buy milk', completed: false });
    const list = await request(app).get('/tasks');
    assert.equal(list.body.length, 1);
  });

  test('POST assigns unique increasing ids', async () => {
    const a = await create('a');
    const b = await create('b');
    assert.notEqual(a.body.id, b.body.id);
  });

  test('POST accepts explicit completed', async () => {
    const res = await request(app).post('/tasks').send({ title: 'x', completed: true });
    assert.equal(res.status, 201);
    assert.equal(res.body.completed, true);
  });

  for (const [name, body] of [
    ['missing title', {}],
    ['empty title', { title: '' }],
    ['blank title', { title: '   ' }],
    ['non-string title', { title: 5 }],
    ['non-boolean completed', { title: 'x', completed: 'yes' }],
    ['array body', [1]],
  ]) {
    test(`POST rejects ${name}`, async () => {
      const res = await request(app).post('/tasks').send(body);
      assert.equal(res.status, 400);
      assert.ok(res.body.error);
    });
  }

  test('POST rejects malformed JSON with 400', async () => {
    const res = await request(app).post('/tasks').set('Content-Type', 'application/json').send('{"title":');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Malformed JSON');
  });

  test('POST without body returns 400', async () => {
    const res = await request(app).post('/tasks');
    assert.equal(res.status, 400);
  });

  test('PUT updates title and completed', async () => {
    await create('old');
    const res = await request(app).put('/tasks/1').send({ title: 'new', completed: true });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { id: 1, title: 'new', completed: true });
  });

  test('PUT updates only completed', async () => {
    await create('keep');
    const res = await request(app).put('/tasks/1').send({ completed: true });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { id: 1, title: 'keep', completed: true });
  });

  test('PUT updates only title', async () => {
    await create('old');
    const res = await request(app).put('/tasks/1').send({ title: 'new' });
    assert.equal(res.body.title, 'new');
    assert.equal(res.body.completed, false);
  });

  test('PUT unknown id returns 404', async () => {
    const res = await request(app).put('/tasks/99').send({ title: 'x' });
    assert.equal(res.status, 404);
  });

  for (const id of ['abc', '0', '-1', '1.5']) {
    test(`PUT/DELETE invalid id "${id}" returns 400`, async () => {
      assert.equal((await request(app).put(`/tasks/${id}`).send({ title: 'x' })).status, 400);
      assert.equal((await request(app).delete(`/tasks/${id}`)).status, 400);
    });
  }

  for (const [name, body] of [
    ['empty object', {}],
    ['empty title', { title: '' }],
    ['non-string title', { title: 1 }],
    ['non-boolean completed', { completed: 'true' }],
  ]) {
    test(`PUT rejects ${name}`, async () => {
      await create('x');
      const res = await request(app).put('/tasks/1').send(body);
      assert.equal(res.status, 400);
    });
  }

  test('PUT rejects malformed JSON', async () => {
    await create('x');
    const res = await request(app).put('/tasks/1').set('Content-Type', 'application/json').send('{bad');
    assert.equal(res.status, 400);
  });

  test('DELETE removes task', async () => {
    await create('x');
    const res = await request(app).delete('/tasks/1');
    assert.equal(res.status, 204);
    assert.deepEqual((await request(app).get('/tasks')).body, []);
  });

  test('DELETE unknown id returns 404', async () => {
    assert.equal((await request(app).delete('/tasks/5')).status, 404);
  });

  test('deleted ids are not reused', async () => {
    await create('a');
    await request(app).delete('/tasks/1');
    const res = await create('b');
    assert.equal(res.body.id, 2);
  });

  test('unknown route returns 404', async () => {
    assert.equal((await request(app).get('/nope')).status, 404);
  });
});
