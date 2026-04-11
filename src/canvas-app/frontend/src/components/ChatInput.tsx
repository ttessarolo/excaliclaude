import React, { useState, KeyboardEvent } from 'react';

interface Props {
  onSend: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ChatInput({ onSend, placeholder, disabled }: Props): JSX.Element {
  const [text, setText] = useState('');

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="chat-input">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder || 'Scrivi a Claude...'}
        disabled={disabled}
        aria-label="Messaggio a Claude"
      />
      <button onClick={submit} disabled={disabled || !text.trim()}>
        Invia
      </button>
    </div>
  );
}
