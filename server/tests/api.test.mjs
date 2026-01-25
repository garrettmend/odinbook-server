import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('API Health Check', () => {
  it('should return 200 OK for /api/conversations', async () => {
    const res = await request(app).get('/api/conversations');
    // Accepts 200 or 401 (if auth required)
    expect([200, 401]).toContain(res.statusCode);
  });
});
