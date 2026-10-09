const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

const NOW = Date.parse('2026-06-15T12:00:00.000Z');

describe('Task deadlines', () => {
  let app;
  beforeEach(() => { app = createApp({ now: () => NOW }); });

  const createTask = (body = {}) => request(app).post('/tasks').send({ title: 't', ...body });
  const overdueTitles = async () =>
    (await request(app).get('/tasks?overdue=true')).body.map((t) => t.title);

  test('task can be created with a dueDate, normalized to ISO with milliseconds', async () => {
    const res = await createTask({ dueDate: '2026-07-01T09:30:00Z' });
    assert.equal(res.status, 201);
    assert.equal(res.body.dueDate, '2026-07-01T09:30:00.000Z');
  });

  test('fractional seconds are accepted', async () => {
    const res = await createTask({ dueDate: '2026-07-01T09:30:00.5Z' });
    assert.equal(res.status, 201);
    assert.equal(res.body.dueDate, '2026-07-01T09:30:00.500Z');
  });

  test('task without dueDate has no dueDate field', async () => {
    const res = await createTask();
    assert.equal(res.body.dueDate, undefined);
  });

  for (const bad of [
    'not a date',
    '2026-07-01',
    '2026-07-01T09:30Z',
    '2026-07-01T09:30:00',
    '2026-07-01T09:30:00+02:00',
    '2026-02-30T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-07-01T24:00:00Z',
    '2026-07-01T09:60:00Z',
    '2026-07-01 09:30:00Z',
    '',
    1767225600000,
    true,
    {},
  ]) {
    test(`invalid dueDate ${JSON.stringify(bad)} is rejected with 400`, async () => {
      assert.equal((await createTask({ dueDate: bad })).status, 400);
      await createTask();
      assert.equal((await request(app).put('/tasks/1').send({ dueDate: bad })).status, 400);
    });
  }

  test('leap day is accepted in a leap year', async () => {
    assert.equal((await createTask({ dueDate: '2028-02-29T00:00:00Z' })).status, 201);
    assert.equal((await createTask({ dueDate: '2027-02-29T00:00:00Z' })).status, 400);
  });

  test('PUT sets, changes and clears dueDate', async () => {
    await createTask();
    let res = await request(app).put('/tasks/1').send({ dueDate: '2026-01-01T00:00:00Z' });
    assert.equal(res.status, 200);
    assert.equal(res.body.dueDate, '2026-01-01T00:00:00.000Z');
    res = await request(app).put('/tasks/1').send({ dueDate: null });
    assert.equal(res.status, 200);
    assert.equal(res.body.dueDate, undefined);
  });

  test('overdue=true returns only incomplete tasks due before now', async () => {
    await createTask({ title: 'past', dueDate: '2026-06-15T11:59:59Z' });
    await createTask({ title: 'future', dueDate: '2026-06-15T12:00:01Z' });
    await createTask({ title: 'past-done', dueDate: '2026-01-01T00:00:00Z', completed: true });
    await createTask({ title: 'no-date' });
    await createTask({ title: 'long-past', dueDate: '2020-01-01T00:00:00Z' });
    assert.deepEqual(await overdueTitles(), ['past', 'long-past']);
  });

  test('task due exactly now is not overdue', async () => {
    await createTask({ title: 'now', dueDate: '2026-06-15T12:00:00Z' });
    assert.deepEqual(await overdueTitles(), []);
  });

  test('tasks without dueDate are never overdue', async () => {
    await createTask({ title: 'a' });
    await createTask({ title: 'b' });
    assert.deepEqual(await overdueTitles(), []);
  });

  test('completing an overdue task removes it from the overdue list', async () => {
    await createTask({ title: 'late', dueDate: '2026-01-01T00:00:00Z' });
    assert.deepEqual(await overdueTitles(), ['late']);
    await request(app).put('/tasks/1').send({ completed: true });
    assert.deepEqual(await overdueTitles(), []);
  });

  test('overdue status follows the clock', async () => {
    let now = NOW;
    app = createApp({ now: () => now });
    await createTask({ title: 'soon', dueDate: '2026-06-16T00:00:00Z' });
    assert.deepEqual(await overdueTitles(), []);
    now = Date.parse('2026-06-17T00:00:00Z');
    assert.deepEqual(await overdueTitles(), ['soon']);
  });

  test('overdue=false returns tasks that are not overdue', async () => {
    await createTask({ title: 'past', dueDate: '2020-01-01T00:00:00Z' });
    await createTask({ title: 'none' });
    const res = await request(app).get('/tasks?overdue=false');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map((t) => t.title), ['none']);
  });

  test('GET /tasks without filter still returns all tasks', async () => {
    await createTask({ title: 'past', dueDate: '2020-01-01T00:00:00Z' });
    await createTask({ title: 'none' });
    assert.equal((await request(app).get('/tasks')).body.length, 2);
  });

  test('invalid overdue value returns 400', async () => {
    assert.equal((await request(app).get('/tasks?overdue=yes')).status, 400);
  });

  test('default clock uses the real current time', async () => {
    app = createApp();
    await createTask({ title: 'past', dueDate: '2000-01-01T00:00:00Z' });
    await createTask({ title: 'future', dueDate: '2999-01-01T00:00:00Z' });
    assert.deepEqual(await overdueTitles(), ['past']);
  });
});
