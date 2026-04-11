import React, { useEffect } from 'react';

interface Props {
  open: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function QuitModal({
  open,
  saving,
  onSave,
  onDiscard,
  onCancel,
}: Props): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="excaliclaude-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quit-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="excaliclaude-modal">
        <h2 id="quit-modal-title">Save before quitting?</h2>
        <p>
          Your canvas has unsaved changes. Would you like to save progress as
          an <code>.excalidraw</code> file before closing this session?
        </p>
        <div className="excaliclaude-modal-actions">
          <button
            className="excaliclaude-modal-btn"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="excaliclaude-modal-btn danger"
            onClick={onDiscard}
            disabled={saving}
          >
            Discard Changes
          </button>
          <button
            className="excaliclaude-modal-btn primary"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Progress'}
          </button>
        </div>
      </div>
    </div>
  );
}
