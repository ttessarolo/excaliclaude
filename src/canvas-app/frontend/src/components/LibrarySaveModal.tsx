import React, { useState, useEffect } from 'react';

interface Props {
  open: boolean;
  files: string[];
  onSave: (filename: string, remember: boolean) => void;
  onCancel: () => void;
}

export function LibrarySaveModal({
  open,
  files,
  onSave,
  onCancel,
}: Props): JSX.Element | null {
  const [mode, setMode] = useState<'existing' | 'new'>(files.length > 0 ? 'existing' : 'new');
  const [selectedFile, setSelectedFile] = useState(files[0] || '');
  const [newName, setNewName] = useState('personal');
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  useEffect(() => {
    if (open) {
      setMode(files.length > 0 ? 'existing' : 'new');
      setSelectedFile(files[0] || '');
    }
  }, [open, files]);

  if (!open) return null;

  const handleSave = (): void => {
    const filename = mode === 'existing'
      ? selectedFile
      : (newName.trim() || 'personal') + '.excalidrawlib';
    onSave(filename, remember);
  };

  return (
    <div
      className="excaliclaude-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-save-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="excaliclaude-modal">
        <h2 id="library-save-modal-title">Save library</h2>
        <p>Choose where to save your library items.</p>

        <div className="library-save-options">
          {files.length > 0 && (
            <label className="library-save-radio">
              <input
                type="radio"
                name="library-save-mode"
                checked={mode === 'existing'}
                onChange={() => setMode('existing')}
              />
              <span>Existing file</span>
            </label>
          )}
          {mode === 'existing' && files.length > 0 && (
            <select
              className="library-save-select"
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
            >
              {files.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          )}

          <label className="library-save-radio">
            <input
              type="radio"
              name="library-save-mode"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
            />
            <span>New file</span>
          </label>
          {mode === 'new' && (
            <div className="library-save-new-file">
              <input
                type="text"
                className="library-save-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="filename"
              />
              <span className="library-save-ext">.excalidrawlib</span>
            </div>
          )}
        </div>

        <label className="library-save-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>Remember this choice</span>
        </label>

        <div className="excaliclaude-modal-actions">
          <button
            className="excaliclaude-modal-btn"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="excaliclaude-modal-btn primary"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
