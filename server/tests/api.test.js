import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('API Health Check', () => {
  it('should return 200 OK for /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('Conversations API', () => {
  it('should return 401 for unauthenticated /api/conversations', async () => {
    const res = await request(app).get('/api/conversations');
    expect(res.statusCode).toBe(401);
  });
  it('should return 401 for unauthenticated POST /api/conversations', async () => {
    const res = await request(app).post('/api/conversations').send({ participantId: 'fake' });
    expect(res.statusCode).toBe(401);
  });
});

describe('Users API', () => {
  it('should return 400, 401, or 404 for /api/users/search without auth', async () => {
    const res = await request(app).get('/api/users/search?name=test');
    expect([401, 400, 404]).toContain(res.statusCode);
  });
});
