import { useNavigate } from '@tanstack/react-router';
import { prepareRouteTransition, setZoomOrigin } from '../../lib/motion';
import { meetingTransition } from '../meetingsHub/meetingsSheets';

/**
 * Opens a meeting from Hoje. With a session the source title is named
 * `m-title` so it morphs into the meeting heading; without one the list opens.
 */
export function useOpenMeeting() {
  const navigate = useNavigate();
  return (sessionId: string | null, titleElement?: Element | null) => {
    if (sessionId) {
      // The meetings screen names its heading during this transition (claimTitleMorph).
      void navigate({
        to: '/meetings/$sessionId',
        params: { sessionId },
        viewTransition: meetingTransition(titleElement),
      });
    } else {
      void navigate({ to: '/meetings', viewTransition: prepareRouteTransition('nav') });
    }
  };
}

/** Zooms into the Workspace around `origin` (a preview card or the preview itself). */
export function useZoomToWorkspace() {
  const navigate = useNavigate();
  return (origin: Element | null, noteId?: string | null) => {
    setZoomOrigin(origin);
    const viewTransition = prepareRouteTransition('zoom');
    if (noteId) void navigate({ to: '/workspace/$noteId', params: { noteId }, viewTransition });
    else void navigate({ to: '/workspace', viewTransition });
  };
}

const preview = () => document.querySelector('[data-workspace-preview]');

export function useGo() {
  const navigate = useNavigate();
  const zoom = useZoomToWorkspace();
  return {
    meetings: () =>
      void navigate({ to: '/meetings', viewTransition: prepareRouteTransition('nav') }),
    /** Hoje to Workspace is always spatial: it zooms from the preview, like the rail. */
    note: (noteId: string) => zoom(preview(), noteId),
    workspace: () => zoom(preview()),
    integrations: () =>
      void navigate({
        to: '/settings',
        hash: 'integrations-heading',
        viewTransition: prepareRouteTransition('nav'),
      }),
  };
}
