import React, { useLayoutEffect, useRef } from "react";
import styled from "styled-components";

// Printed text you can click into and retype. Enter or clicking away saves;
// Escape puts back what was there. It looks exactly like the text around it.
export default function InlineField({
  display,
  onCommit,
  onDone,
  label,
  placeholder,
  autoFocus = false,
  disabled = false,
  className,
}) {
  const ref = useRef(null);
  const editing = useRef(false);

  // Uncontrolled while focused, so the caret never jumps; refreshed otherwise.
  useLayoutEffect(() => {
    if (!editing.current && ref.current) ref.current.textContent = display;
  }, [display]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!autoFocus || !element) return;
    element.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }, [autoFocus]);

  const finish = () => {
    const element = ref.current;
    editing.current = false;
    const text = element.textContent.replace(/\s+/g, " ").trim();
    // Show the committed value; if the parent rejects it, this restores the old one.
    element.textContent = display;
    onCommit(text);
    onDone?.();
  };

  return (
    <Field
      ref={ref}
      className={className}
      contentEditable={disabled ? false : "plaintext-only"}
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      data-placeholder={placeholder}
      spellCheck={false}
      onFocus={() => {
        editing.current = true;
      }}
      onBlur={finish}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.textContent = display;
          event.currentTarget.blur();
        }
      }}
      onPaste={(event) => {
        // One line of plain text, whatever was copied.
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain").replace(/\s+/g, " ");
        document.execCommand("insertText", false, text);
      }}
    />
  );
}

const Field = styled.span`
  font: inherit;
  letter-spacing: inherit;
  color: inherit;
  white-space: pre-wrap;
  outline: none;
  cursor: text;
  caret-color: currentColor;

  &:empty::before {
    content: attr(data-placeholder);
    opacity: 0.45;
  }
`;
