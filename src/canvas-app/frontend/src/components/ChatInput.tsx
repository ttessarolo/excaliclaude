import React, {
  useLayoutEffect,
  useRef,
  useState,
  KeyboardEvent,
} from 'react';

interface Props {
  onSend: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
}

const MAX_ROWS = 3;

export function ChatInput({
  onSend,
  placeholder,
  disabled,
  busy,
}: Props): JSX.Element {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = (): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter → submit. Shift+Enter or Alt/Option+Enter → newline.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      submit();
    }
  };

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Collapse first so scrollHeight reflects content only (not previous height).
    ta.style.height = 'auto';
    const style = window.getComputedStyle(ta);
    const lineHeight = parseFloat(style.lineHeight) || 18;
    const paddingY =
      parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const borderY =
      parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    // With box-sizing: border-box, height = content + padding + border.
    // scrollHeight = content + padding (no border), so add borderY.
    const contentPlusPadding = ta.scrollHeight;
    const maxHeight = lineHeight * MAX_ROWS + paddingY + borderY;
    const next = Math.min(contentPlusPadding + borderY, maxHeight);
    ta.style.height = `${next}px`;
    ta.style.overflowY =
      contentPlusPadding + borderY > maxHeight ? 'auto' : 'hidden';
  }, [text]);

  const inputDisabled = disabled || busy;
  const sendDisabled = inputDisabled || !text.trim();

  return (
    <div className="chat-input">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder || 'Message Claude...'}
        disabled={inputDisabled}
        rows={1}
        aria-label="Message to Claude"
      />
      <button
        type="button"
        onClick={submit}
        disabled={sendDisabled}
        className={busy ? 'sending' : undefined}
        aria-label="Send message"
      >
        {busy ? (
          <span className="send-spinner" aria-hidden="true" />
        ) : (
          'Send'
        )}
      </button>
    </div>
  );
}
