import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { createAppRouter } from './router';
it('opens the activity map first and retains compatible library, note and home routes', () => {
  const router = createAppRouter(new QueryClient());
  expect(router.history.location.pathname).toBe('/');
  for (const path of [
    '/',
    '/home',
    '/meetings',
    '/notes',
    '/agenda',
    '/calendar',
    '/sessions/$sessionId',
  ] as const)
    expect(router.routesByPath[path]).toBeDefined();
});
