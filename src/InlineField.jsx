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

  // The placeholder is real text once you click in, all selected: type over
  // it, or change just a word. Left as it was, it still counts as empty.
  const begin = () => {
    editing.current = true;
    const element = ref.current;
    if (!placeholder || element.textContent) return;
    element.textContent = placeholder;
    requestAnimationFrame(() => {
      if (document.activeElement !== element) return;
      const range = document.createRange();
      range.selectNodeContents(element);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
  };

  const finish = () => {
    const element = ref.current;
    editing.current = false;
    const typed = element.textContent.replace(/\s+/g, " ").trim();
    const text = typed === placeholder ? "" : typed;
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
      onFocus={begin}
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
  /* A box of its own, so even an empty field can be clicked into. */
  display: inline-block;
  min-width: 1ch;
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
