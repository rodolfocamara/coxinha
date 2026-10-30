import {
  createRouter,
  createRootRouteWithContext,
  createRoute,
  createMemoryHistory,
  Outlet,
} from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';

import { waitForNotePersistence } from './lib/noteSessions';
import { AppError } from './lib/AppError';
import { RootLayout } from './routes/__root';
import { SessionRoute } from './routes/SessionRoute';
import { HomeRoute } from './routes/HomeRoute';
import { NotesIndexRoute } from './routes/NotesIndexRoute';
import {
  NoteDetailRoute,
  NoteDetailError,
  noteContentQueryOptions,
} from './routes/NoteDetailRoute';
import { CalendarRoute } from './routes/CalendarRoute';
import { PeopleRoute } from './routes/PeopleRoute';
import { AgendaRoute } from './routes/AgendaRoute';
import { MeetingsRoute } from './routes/MeetingsRoute';
import { SettingsRoute } from './routes/SettingsRoute';
import { DevMenuPreviewRoute } from './routes/DevMenuPreviewRoute';
import { DevShellPreviewRoute } from './routes/DevShellPreviewRoute';

export interface RouterContext {
  queryClient: QueryClient;
}

// Root carries QueryClient through loader context so nested routes
// can `ensureQueryData` without hook access.
const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: AppError,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: NotesIndexRoute,
});

const notesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'notes',
  component: () => <Outlet />,
});

const notesIndexRoute = createRoute({
  getParentRoute: () => notesRoute,
  path: '/',
  component: NotesIndexRoute,
});

const noteDetailRoute = createRoute({
  getParentRoute: () => notesRoute,
  path: '$noteId',
  loader: async ({ params, context }) => {
    // The editor owns recovery of retained unsaved text when a write fails.
    await waitForNotePersistence(params.noteId).catch(() => {});
    return context.queryClient.ensureQueryData(noteContentQueryOptions(params.noteId));
  },
  component: NoteDetailRoute,
  errorComponent: NoteDetailError,
});

const agendaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'agenda',
  component: AgendaRoute,
});

const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'calendar',
  component: CalendarRoute,
});

const meetingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'meetings',
  component: MeetingsRoute,
});

const peopleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'people',
  component: PeopleRoute,
});

const legacyHomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'home',
  component: HomeRoute,
});
const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'sessions/$sessionId',
  component: SessionRoute,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings',
  component: SettingsRoute,
});

// Dev-only preview routes (stripped from prod bundle by the
// `import.meta.env.DEV` guard below). Let Playwright + humans
// visually check UI primitives without a real note.
const devMenuPreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'dev/menu-preview',
  component: DevMenuPreviewRoute,
});

const devShellPreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'dev/shell-preview',
  component: DevShellPreviewRoute,
});

const baseChildren = [
  indexRoute,
  legacyHomeRoute,
  sessionRoute,
  notesRoute.addChildren([notesIndexRoute, noteDetailRoute]),
  agendaRoute,
  calendarRoute,
  peopleRoute,
  meetingsRoute,
  settingsRoute,
];
const routeTree = rootRoute.addChildren(
  import.meta.env.DEV ? [...baseChildren, devMenuPreviewRoute, devShellPreviewRoute] : baseChildren
);

export function createAppRouter(queryClient: QueryClient) {
  // Memory history in F1 Tauri — no address bar, URL is internal
  // state. Open the activity map; legacy destinations retain compatible routes.
  // Spec 0039 reserves hash history for a future web build.
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { queryClient },
    defaultErrorComponent: AppError,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
