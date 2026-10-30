import { useRef, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from './Button';
import './ui.css';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Accessible name of the close button (localized by the caller). */
  closeLabel: string;
  footer?: ReactNode;
  children: ReactNode;
};

/** Right-side modal panel: focus trap, Escape and focus return come from Radix. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  footer,
  children,
}: Props) {
  // Radix restores focus only to a Dialog.Trigger; callers open sheets from any control.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="cx-sheet-overlay" />
        <Dialog.Content
          className="cx-sheet"
          {...(description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={() => {
            opener.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
            opener.current = null;
          }}
        >
          <header className="cx-sheet-header">
            <div className="min-w-0">
              <Dialog.Title className="cx-sheet-title">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="cx-sheet-description">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={closeLabel}
                icon={<X size={16} aria-hidden="true" />}
              />
            </Dialog.Close>
          </header>
          <div className="cx-sheet-body">{children}</div>
          {footer && <footer className="cx-sheet-footer">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
