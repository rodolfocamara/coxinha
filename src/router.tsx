import {
  createRouter,
  createRootRouteWithContext,
  createRoute,
  createMemoryHistory,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';

import { waitForNotePersistence } from './lib/noteSessions';
import { AppError } from './lib/AppError';
import { RootLayout } from './routes/__root';
import { NoteDetailError, noteContentQueryOptions } from './routes/NoteDetailRoute';
import { HojeRoute } from './features/hoje/HojeRoute';
import { MeetingsHubRoute } from './features/meetingsHub/MeetingsHubRoute';
import { validateMeetingsSearch } from './features/meetingsHub/meetingsSearch';
import { WorkspaceRoute } from './features/workspace/WorkspaceRoute';
import { PeopleRoute } from './routes/PeopleRoute';
import { SettingsRoute } from './routes/SettingsRoute';

export interface RouterContext {
  queryClient: QueryClient;
}

// Root carries QueryClient through loader context so nested routes
// can `ensureQueryData` without hook access.
const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: AppError,
});

// Spec 0096 information architecture: Hoje at `/`, Workspace (board + notes)
// at `/workspace`, Reuniões at `/meetings`. Legacy paths redirect.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HojeRoute,
});

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspace',
  component: () => <Outlet />,
});

const workspaceIndexRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/',
  component: WorkspaceRoute,
});

const notesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'notes',
  component: () => <Outlet />,
});

const notesIndexRoute = createRoute({
  getParentRoute: () => notesRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/workspace' });
  },
});

const legacyNoteRoute = createRoute({
  getParentRoute: () => notesRoute,
  path: '$noteId',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/workspace/$noteId', params: { noteId: params.noteId } });
  },
});

const noteDetailRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '$noteId',
  loader: async ({ params, context }) => {
    // The editor owns recovery of retained unsaved text when a write fails.
    await waitForNotePersistence(params.noteId).catch(() => {});
    return context.queryClient.ensureQueryData(noteContentQueryOptions(params.noteId));
  },
  component: WorkspaceRoute,
  errorComponent: NoteDetailError,
});

// Spec 0096 P4: the Outlook agenda and the calendar live in Reuniões.
const agendaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'agenda',
  beforeLoad: () => {
    throw redirect({ to: '/meetings' });
  },
});

const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'calendar',
  beforeLoad: () => {
    throw redirect({ to: '/meetings', search: { tab: 'month' } });
  },
});

const meetingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'meetings',
  component: () => <Outlet />,
});

const meetingsIndexRoute = createRoute({
  getParentRoute: () => meetingsRoute,
  path: '/',
  validateSearch: validateMeetingsSearch,
  component: MeetingsHubRoute,
});

const meetingDetailRoute = createRoute({
  getParentRoute: () => meetingsRoute,
  path: '$sessionId',
  validateSearch: validateMeetingsSearch,
  component: MeetingsHubRoute,
});

const peopleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'people',
  component: PeopleRoute,
});

const legacyHomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'home',
  beforeLoad: () => {
    throw redirect({ to: '/' });
  },
});
const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'sessions/$sessionId',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/meetings/$sessionId', params: { sessionId: params.sessionId } });
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings',
  component: SettingsRoute,
});

const baseChildren = [
  indexRoute,
  legacyHomeRoute,
  sessionRoute,
  workspaceRoute.addChildren([workspaceIndexRoute, noteDetailRoute]),
  notesRoute.addChildren([notesIndexRoute, legacyNoteRoute]),
  agendaRoute,
  calendarRoute,
  peopleRoute,
  meetingsRoute.addChildren([meetingsIndexRoute, meetingDetailRoute]),
  settingsRoute,
];
const routeTree = rootRoute.addChildren(baseChildren);

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
