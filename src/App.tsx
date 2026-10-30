import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';

import { DesktopLifecycle } from './lib/DesktopLifecycle';
import { createAppRouter } from './router';

export default function App() {
  // QueryClient + Router instantiated once per app mount. The router
  // lives in component state so StrictMode's double-invoke during
  // dev doesn't rebuild it between effects.
  const [{ queryClient, router }] = useState(() => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
        },
      },
    });
    const router = createAppRouter(queryClient);
    return { queryClient, router };
  });

  // Dev handle for Playwright-driven visual checks — lets a test
  // seed the query cache + navigate without a real Tauri backend.
  // Lives in an effect (not the `useState` initializer) so
  // StrictMode's double-invoke can't leave a stale pointer to an
  // unmounted router on window. Stripped from prod via Vite's
  // `import.meta.env.DEV` guard.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __coxinha?: unknown };
    w.__coxinha = { queryClient, router };
    return () => {
      delete w.__coxinha;
    };
  }, [queryClient, router]);

  return (
    <QueryClientProvider client={queryClient}>
      <DesktopLifecycle />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
