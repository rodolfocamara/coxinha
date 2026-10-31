import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, CircleCheck, LoaderCircle, Plus, SquareDashed } from 'lucide-react';
import { Alert, Button } from '../../components/ui';
import { boardSession, errorCategory } from '../board/persistence';
import type { Workspace } from './useWorkspace';

const flush = () => void boardSession.flush().catch(() => {});

/** "Workspace" title, Nota / Atividade / Área, save state and board recovery. */
export function WorkspaceToolbar({ ws }: { ws: Workspace }) {
  const { t } = useTranslation();
  const { dirty, error } = ws.session;
  const [savedTick, setSavedTick] = useState(0);
  const wasDirty = useRef(dirty);
  const [recovery, setRecovery] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  useEffect(() => {
    if (wasDirty.current && !dirty && !error) setSavedTick((n) => n + 1);
    wasDirty.current = dirty;
  }, [dirty, error]);
  const state = error ? 'notSaved' : dirty ? 'saving' : 'saved';
  return (
    <>
      <div className="ws-toolbar" role="toolbar" aria-label={t('workspace.toolbar.label')}>
        <h1 className="ws-toolbar-title">{t('workspace.title')}</h1>
        <Button
          size="sm"
          variant="primary"
          icon={<Plus size={14} aria-hidden="true" />}
          disabled={!ws.board || ws.creating === 'busy'}
          onClick={() => ws.createNote()}
        >
          {t('workspace.toolbar.note')}
        </Button>
        <Button
          size="sm"
          icon={<CircleCheck size={14} aria-hidden="true" />}
          disabled={!ws.board || ws.creating === 'busy'}
          onClick={ws.createActivity}
        >
          {t('workspace.toolbar.activity')}
        </Button>
        <Button
          size="sm"
          icon={<SquareDashed size={14} aria-hidden="true" />}
          disabled={!ws.board}
          onClick={ws.addArea}
        >
          {t('workspace.toolbar.area')}
        </Button>
        <span className="flex-1" />
        {ws.creating === 'busy' && (
          <span role="status" className="ws-save">
            {t('workspace.toolbar.creating')}
          </span>
        )}
        <span role="status" className="ws-save" data-state={state}>
          {error ? (
            <AlertTriangle size={13} aria-hidden="true" />
          ) : dirty ? (
            <LoaderCircle size={13} aria-hidden="true" className="animate-spin" />
          ) : (
            <Check
              key={savedTick}
              size={13}
              aria-hidden="true"
              className={savedTick ? 'cx-pop' : ''}
            />
          )}
          {t(`workspace.toolbar.${state}`)}
        </span>
        {error && (
          <Button size="xs" onClick={flush}>
            {t('workspace.retry')}
          </Button>
        )}
      </div>
      {ws.creating === 'failed' && (
        <Alert
          tone="error"
          className="ws-banner"
          action={
            <span className="flex gap-1.5">
              <Button size="xs" onClick={ws.retryCreate}>
                {t('workspace.retry')}
              </Button>
              <Button size="xs" variant="ghost" onClick={ws.dismissCreate}>
                {t('workspace.cancel')}
              </Button>
            </span>
          }
        >
          {t('workspace.errors.create')}
        </Alert>
      )}
      {ws.actionError && !error && (
        <Alert
          tone="error"
          className="ws-banner"
          action={
            <Button size="xs" variant="ghost" onClick={() => ws.setActionError(false)}>
              {t('workspace.dismiss')}
            </Button>
          }
        >
          {t('workspace.errors.action')}
        </Alert>
      )}
      {error && (
        <Alert
          tone="error"
          className="ws-banner"
          action={
            <span className="flex flex-wrap gap-1.5">
              <Button
                size="xs"
                onClick={() =>
                  void boardSession
                    .exportRecovery()
                    .then(() => setRecovery(true))
                    .catch(() => ws.setActionError(true))
                }
              >
                {t('workspace.errors.export')}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirmReload(true)}>
                {t('workspace.errors.reload')}
              </Button>
            </span>
          }
        >
          {t(`workspace.errors.${errorCategory(error)}`)}
          {recovery && <span className="block">{t('workspace.errors.recoverySaved')}</span>}
        </Alert>
      )}
      {confirmReload && (
        <div
          role="alertdialog"
          aria-label={t('workspace.errors.reload')}
          className="ws-banner ws-confirm"
        >
          <p>{t('workspace.errors.reloadConfirm')}</p>
          <Button
            size="xs"
            variant="danger"
            onClick={() =>
              void boardSession
                .reloadSaved()
                .then(() => setConfirmReload(false))
                .catch(() => ws.setActionError(true))
            }
          >
            {t('workspace.errors.discard')}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setConfirmReload(false)}>
            {t('workspace.cancel')}
          </Button>
        </div>
      )}
    </>
  );
}
