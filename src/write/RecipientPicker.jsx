import React, { useState } from "react";
import styled, { keyframes } from "styled-components";

const MAX_MATCHES = 3;

// The name field beside Send, completing names the way tags complete in the
// logbook: the best match finishes the word inline, up to two others wait
// below it. ↑/↓ picks, Tab or Enter takes it, → at the end takes the inline
// one, Escape lets it go.
export default function RecipientPicker({ value, onChange, names, disabled, onSubmit, placeholder }) {
  const [index, setIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const query = value.trim().toLowerCase();
  const matches =
    focused && !dismissed && query
      ? names.filter((name) => name.startsWith(query) && name !== query).slice(0, MAX_MATCHES)
      : [];
  const selected = Math.min(index, Math.max(0, matches.length - 1));
  // Only finish the word when what's typed is exactly the start of the name.
  const completion = matches[0]?.startsWith(value.toLowerCase()) ? matches[0].slice(value.length) : "";

  const change = (next) => {
    setIndex(0);
    setDismissed(false);
    onChange(next);
  };

  const choose = (name) => {
    change(name);
    setDismissed(true);
  };

  const onKeyDown = (event) => {
    if (event.nativeEvent.isComposing) return;
    if (matches.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setIndex((selected + step + matches.length) % matches.length);
    } else if (matches.length && (event.key === "Tab" || event.key === "Enter")) {
      event.preventDefault();
      choose(matches[selected]);
    } else if (
      completion &&
      event.key === "ArrowRight" &&
      event.currentTarget.selectionStart === value.length
    ) {
      event.preventDefault();
      choose(matches[0]);
    } else if (matches.length && event.key === "Escape") {
      event.preventDefault();
      setDismissed(true);
    } else if (event.key === "Enter") {
      onSubmit();
    }
  };

  return (
    <Picker>
      <Tag>
      <Field>
        {/* Sizes the field to what's typed plus the completion, and draws the completion. */}
        <Sizer aria-hidden="true">
          <Typed>{value || placeholder}</Typed>
          {completion && <Completion>{completion}</Completion>}
        </Sizer>
        <input
          role="combobox"
          // Inputs default to ~20 characters wide; the sizer sets the real width.
          size={1}
          aria-label="Who it's for"
          aria-autocomplete="both"
          aria-expanded={matches.length > 0}
          aria-controls="recipient-options"
          aria-activedescendant={matches.length ? `recipient-option-${selected}` : undefined}
          value={value}
          placeholder={placeholder}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => change(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </Field>
      </Tag>
      {matches.length > 0 && (
        <Options id="recipient-options" role="listbox" aria-label="People you've written to">
          <HiddenOption id="recipient-option-0" role="option" aria-selected={selected === 0}>
            {matches[0]}
          </HiddenOption>
          {matches.slice(1).map((name, offset) => {
            const optionIndex = offset + 1;
            return (
              <Option
                key={name}
                id={`recipient-option-${optionIndex}`}
                role="option"
                aria-selected={selected === optionIndex}
                $selected={selected === optionIndex}
                // Keep focus in the field so the choice lands there.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(name)}
              >
                {name}
              </Option>
            );
          })}
        </Options>
      )}
    </Picker>
  );
}

const cream = "#f6efe1";

const Picker = styled.div`
  position: relative;
`;

// A luggage tag cut from red paper, with a punched hole, that the name is
// written on. The shadow sits on this wrapper because the
// tag's own shape clips anything drawn outside it.
const Tag = styled.span`
  position: relative;
  display: inline-block;
  transform: rotate(-2deg);
  filter: drop-shadow(0 2px 2px rgba(30, 10, 8, 0.35)) drop-shadow(0 6px 10px rgba(30, 10, 8, 0.18));

`;

// The input and its sizer share one grid cell, so the field is exactly as wide
// as its text, in every browser.
const Field = styled.label`
  display: inline-grid;
  vertical-align: baseline;
  /* The typed text and its completion have to start at the same place. */
  text-align: left;
  background:
    url("/textures/cream-paper.png"),
    linear-gradient(170deg, #a32631, #7d1520);
  background-blend-mode: multiply, normal;
  /* Pointed end on the left, and the hole punched through it. */
  clip-path: polygon(14px 0, 100% 0, 100% 100%, 14px 100%, 0 50%);
  mask: radial-gradient(circle at 15px 50%, transparent 3.4px, #000 3.9px);
  cursor: text;

  & > * {
    grid-area: 1 / 1;
    min-width: 0;
    padding: 6px 14px 6px 26px;
    /* The same stamped type as the location line. */
    font-family: "DIY", "Courier New", monospace;
    /* 16px keeps iOS from zooming in on focus. */
    font-size: 16px;
    line-height: 1.3;
    letter-spacing: 0.04em;
  }

  input {
    width: 100%;
    text-align: left;
    border: none;
    border-radius: 0;
    background: transparent;
    color: #fbf3e8;
    outline: none;

    &::placeholder {
      color: rgba(251, 243, 232, 0.6);
    }
  }
`;

const Sizer = styled.span`
  min-width: 2ch;
  white-space: pre;
  pointer-events: none;
`;

const Typed = styled.span`
  visibility: hidden;
`;

const Completion = styled.span`
  color: rgba(251, 243, 232, 0.5);
`;

const appear = keyframes`
  from {
    opacity: 0;
    transform: translateY(3px);
  }
`;

const fade = keyframes`
  from {
    opacity: 0;
  }
`;

// Fades in once; after that it keeps up with typing without sliding about.
const Options = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding-top: 6px;
  animation: ${appear} 140ms cubic-bezier(0.23, 1, 0.32, 1);

  @media (prefers-reduced-motion: reduce) {
    animation-name: ${fade};
  }
`;

const Option = styled.button`
  min-height: 28px;
  padding: 4px 11px;
  border: none;
  border-radius: 999px;
  background: rgba(246, 239, 225, 0.14);
  color: ${({ $selected }) => ($selected ? "#fff" : "rgba(246, 239, 225, 0.75)")};
  box-shadow: ${({ $selected }) => ($selected ? `inset 0 0 0 1px ${cream}` : "none")};
  font-family: "DIY", "Courier New", monospace;
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
  transition: color 120ms ease;

  @media (hover: hover) and (pointer: fine) {
    &:hover {
      color: #fff;
    }
  }
`;

const HiddenOption = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
`;
