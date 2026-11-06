import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Fragment, Slice } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import styled, { createGlobalStyle, css, keyframes } from "styled-components";
import InlineField from "../InlineField.jsx";
import PostageAddress from "../PostageAddress.jsx";
import {
  POSTCARD_IMPRINT,
  STAMP_LIBRARY,
  fontFaces,
  imprintText,
  letterInk,
  letterType,
  mediaImage,
  mobileAddressFloat,
  mobileLetterBody,
  mobileLetterInsets,
  mobileLetterText,
  mobilePaperShadow,
  mobilePostdate,
  paperBack,
  postmarkInk,
} from "../paper.js";
import { isRecipientSlug, recipientSlug } from "../recipients.js";
import { clipboardUrl, defaultDocument, letterExtensions, linkUrl, plainTextContent } from "./markdown.js";
import { blobToBase64, clearDraft, loadDraft, prepareImage, saveDraft } from "./storage.js";

// The composer lives at /write/<key>; the key in its own address is what
// lets it send. (Under the dev server it's just /write/, and no key is needed.)
const WRITE_KEY = decodeURIComponent(window.location.pathname.match(/^\/write\/([^/]+)/)?.[1] || "");
const RECIPIENT_KEY = "letter-composer:recipient";
const DEFAULT_LOCATION = "somewhere on a lonely blue planet";
const SAVE_DELAY = 500;
const BUBBLE_KEY = "letterFormatting";

// A compact round mark that cancels the stamp without covering the address.
const POSTMARK =
  STAMP_LIBRARY.find((stamp) => stamp.name === "mail-service-round.svg") || STAMP_LIBRARY[0];
const FALLBACK_POSTMARK =
  STAMP_LIBRARY.find((stamp) => stamp.name === "postmark-special-delivery.svg") || POSTMARK;

const today = () => new Date().toLocaleDateString("en-CA");
const randomStamp = () => STAMP_LIBRARY[Math.floor(Math.random() * STAMP_LIBRARY.length)]?.name || "";
const defaultFields = () => ({
  date: today(),
  to: "Saiyam",
  from: "Divya",
  location: "",
  stamp: randomStamp(),
});
// randomUUID needs a secure context, which a phone on the LAN dev server isn't.
const newImageId = () => `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Matches the date stamped on letters in the stack.
function formatPostdate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day).toLocaleDateString() : value;
}

// Reads a typed date: 11/6/2026, 11/6/26, 2026-11-06 or "Nov 6, 2026".
function parseDate(text) {
  const pad = (number) => String(number).padStart(2, "0");
  const build = (year, month, day) => {
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
      ? `${year}-${pad(month)}-${pad(day)}`
      : null;
  };
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return build(+match[1], +match[2], +match[3]);
  match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (match) return build(match[3].length === 2 ? 2000 + +match[3] : +match[3], +match[1], +match[2]);
  const parsed = /[a-z]/i.test(text) ? new Date(text) : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? build(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate())
    : null;
}

function formatDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function imageFiles(list) {
  return [...(list || [])].filter((file) => file.type.startsWith("image/"));
}

function htmlHasText(html) {
  return Boolean(html && new DOMParser().parseFromString(html, "text/html").body.textContent.trim());
}

function imageNodes(doc) {
  const found = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "image") found.push({ node, pos });
  });
  return found;
}

// ProseMirror's selection can trail the browser's by a keystroke (a quick
// shift-arrow then ⌘K). Catch it up before acting on it.
function syncSelection(view) {
  const native = window.getSelection();
  if (!(view.state.selection instanceof TextSelection) || !native?.anchorNode) return;
  if (!view.dom.contains(native.anchorNode) || !view.dom.contains(native.focusNode)) return;
  try {
    const anchor = view.posAtDOM(native.anchorNode, native.anchorOffset);
    const head = view.posAtDOM(native.focusNode, native.focusOffset);
    const { selection } = view.state;
    if (selection.anchor !== anchor || selection.head !== head) {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
    }
  } catch {
    // The DOM selection sits somewhere ProseMirror can't map; keep its own.
  }
}

// Photos live as blobs keyed by id; the document only references them.
const images = new Map();

function registerImage(blob, id = newImageId()) {
  const entry = { blob, url: URL.createObjectURL(blob) };
  images.set(id, entry);
  return { id, ...entry };
}

function forgetImages() {
  images.forEach(({ url }) => URL.revokeObjectURL(url));
  images.clear();
}

// Stored documents reference blob URLs from an earlier session; point each
// photo at its fresh URL and drop any whose blob is gone.
function restoreImages(node) {
  if (node.type === "image") {
    const entry = images.get(node.attrs?.imageId);
    return entry ? { ...node, attrs: { ...node.attrs, src: entry.url } } : null;
  }
  if (!node.content) return node;
  return { ...node, content: node.content.map(restoreImages).filter(Boolean) };
}

function App() {
  const [draft, setDraft] = useState(undefined);
  const [letterKey, setLetterKey] = useState(0);

  useEffect(() => {
    loadDraft().then((saved) => {
      if (!saved?.doc) return setDraft(null);
      for (const [id, blob] of saved.images || []) registerImage(blob, id);
      const fields = { ...defaultFields(), ...saved.fields };
      if (!saved.dateTouched) fields.date = today();
      if (!STAMP_LIBRARY.some((stamp) => stamp.name === fields.stamp)) fields.stamp = randomStamp();
      setDraft({ ...saved, fields, doc: restoreImages(saved.doc) });
    });
  }, []);

  const startOver = () => {
    forgetImages();
    setDraft(null);
    setLetterKey((key) => key + 1);
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <GlobalStyle />
      <Page>
        {draft !== undefined && <Composer key={letterKey} draft={draft} onStartOver={startOver} />}
      </Page>
    </>
  );
}

function Composer({ draft, onStartOver }) {
  const urlInputRef = useRef(null);
  const labelInputRef = useRef(null);
  const saveTimer = useRef(0);
  const importing = useRef(new Set());
  // Photos still being shrunk for upload, by id.
  const preparing = useRef(new Map());
  const dateTouched = useRef(Boolean(draft?.dateTouched));
  const urlEdited = useRef(false);
  const clipboardRequest = useRef(0);
  const linkOpen = useRef(false);
  const [fields, setFields] = useState(() => draft?.fields || defaultFields());
  const [link, setLinkState] = useState(null);
  const [recipient, setRecipient] = useState(() => draft?.recipient ?? localStorage.getItem(RECIPIENT_KEY) ?? "");
  const [recipients, setRecipients] = useState([]);
  const [sentTo, setSentTo] = useState(null);
  const [status, setStatus] = useState({ kind: "idle" });
  const latest = useRef({});
  latest.current = { fields, recipient };
  const editorRef = useRef(null);

  // The bubble menu reads this outside React, so it's mirrored in a ref.
  const setLink = (next) => {
    setLinkState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      linkOpen.current = Boolean(value);
      return value;
    });
  };

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) return;
      const used = [...new Set(imageNodes(editor.state.doc).map(({ node }) => node.attrs.imageId))]
        .filter((id) => images.has(id))
        .map((id) => [id, images.get(id).blob]);
      saveDraft({
        fields: latest.current.fields,
        recipient: latest.current.recipient,
        dateTouched: dateTouched.current,
        doc: editor.getJSON(),
        images: used,
      });
    }, SAVE_DELAY);
  }, []);

  // Remote images in pasted HTML (e.g. from Google Docs) are copied in as
  // blobs, since their URLs often expire.
  const importRemoteImages = useCallback((editor) => {
    for (const { node } of imageNodes(editor.state.doc)) {
      const { src, imageId, unresolved } = node.attrs;
      if (imageId || unresolved || !src || importing.current.has(src)) continue;
      importing.current.add(src);

      fetch(src)
        .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(response.statusText))))
        .then(prepareImage)
        .then((blob) => {
          if (!blob.type.startsWith("image/")) throw new Error("Not an image");
          const { id, url } = registerImage(blob);
          return { imageId: id, src: url };
        })
        .catch(() => ({ unresolved: true }))
        .then((attrs) => {
          importing.current.delete(src);
          if (editor.isDestroyed) return;
          const { tr } = editor.state;
          for (const match of imageNodes(editor.state.doc)) {
            if (match.node.attrs.src === src && !match.node.attrs.imageId) {
              tr.setNodeMarkup(match.pos, undefined, { ...match.node.attrs, ...attrs });
            }
          }
          editor.view.dispatch(tr.setMeta("addToHistory", false));
        });
    }
  }, []);

  // Photos go in straight away, where the caret is now, and are shrunk for
  // upload in the background. Waiting first would drop them wherever the
  // caret had moved to by then.
  const insertImages = (files, position) => {
    const editor = editorRef.current;
    const nodes = files.map((file) => {
      const { id, url } = registerImage(file);
      const ready = prepareImage(file)
        .then((blob) => {
          if (blob !== file && images.has(id)) images.set(id, { blob, url: images.get(id).url });
        })
        .finally(() => {
          preparing.current.delete(id);
          scheduleSave();
        });
      preparing.current.set(id, ready);
      return { type: "image", attrs: { src: url, imageId: id, alt: "" } };
    });
    // Focus right away if needed: Tiptap's focus() waits a frame, and could
    // pull focus back from wherever someone has moved on to in that time.
    if (!editor.isFocused) editor.view.focus();
    const chain = editor.chain();
    (position == null ? chain.insertContent(nodes) : chain.insertContentAt(position, nodes)).run();

    // Leave the caret after the photos, not selecting the last one, so the
    // next paste or keystroke doesn't replace it.
    const { state } = editor;
    if (state.selection instanceof NodeSelection) {
      const after = state.selection.to;
      const tr = state.tr;
      const next = state.doc.resolve(after).nodeAfter;
      if (!(next?.type.name === "paragraph" && next.content.size === 0)) {
        tr.insert(after, state.schema.nodes.paragraph.create());
      }
      editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView());
    }
  };

  const openLink = () => {
    const editor = editorRef.current;
    if (linkOpen.current) return urlInputRef.current?.focus();
    syncSelection(editor.view);
    let { from, to, empty } = editor.state.selection;
    let mode = empty ? "insert" : "selection";
    let href = "";

    if (editor.isActive("link")) {
      // Editing an existing link covers the whole link, label and URL.
      editor.chain().extendMarkRange("link").run();
      ({ from, to } = editor.state.selection);
      href = String(editor.getAttributes("link").href || "");
      mode = "edit";
    }

    const label = editor.state.doc.textBetween(from, to, "\n");
    urlEdited.current = false;
    linkOpen.current = true;
    setLink({ mode, from, to, label, href, error: "" });

    if (mode !== "edit") {
      const request = ++clipboardRequest.current;
      // Read once, inside this gesture. If it's denied, typing a URL still works.
      navigator.clipboard?.readText?.().then((value) => {
        if (request !== clipboardRequest.current || urlEdited.current) return;
        const url = clipboardUrl(value);
        if (url) setLink((current) => (current ? { ...current, href: url } : current));
      }).catch(() => {});
    }
  };

  const closeLink = () => {
    clipboardRequest.current += 1;
    linkOpen.current = false;
    // Focus synchronously: the next keystroke must not land in the closing form.
    editorRef.current.view.focus();
    setLink(null);
  };

  const applyLink = () => {
    const editor = editorRef.current;
    const { mode, from, to, label, href } = link;
    const range = { from, to };

    if (mode === "edit" && !href.trim()) {
      editor.chain().focus().setTextSelection(range).unsetLink().setTextSelection(to).run();
      return closeLink();
    }
    if (mode === "edit" && !label.trim()) {
      editor.chain().focus().deleteRange(range).run();
      return closeLink();
    }

    const url = linkUrl(href);
    if (!url) {
      setLink({ ...link, error: "That doesn't look like a link." });
      return urlInputRef.current?.focus();
    }

    if (mode === "selection") {
      editor.chain().focus().setTextSelection(range).setLink({ href: url }).setTextSelection(to).run();
    } else {
      const original = editor.state.doc.textBetween(from, to, "\n");
      const text = label.trim() ? label : href.trim();
      if (mode === "edit" && text === original) {
        editor.chain().focus().setTextSelection(range).setLink({ href: url }).setTextSelection(to).run();
      } else {
        // Replacing a label keeps the formatting it had, apart from the link.
        const marks = editor.state.doc
          .resolve(from + (from < to ? 1 : 0))
          .marks()
          .filter((mark) => mark.type.name !== "link")
          .map((mark) => mark.toJSON());
        editor
          .chain()
          .focus()
          .insertContentAt(range, { type: "text", text, marks: [...marks, { type: "link", attrs: { href: url } }] })
          .run();
      }
    }
    closeLink();
  };

  const editor = useEditor({
    extensions: letterExtensions(),
    content: draft?.doc || defaultDocument(draft?.fields || defaultFields()),
    // Typed punctuation stays literal; formatting comes from shortcuts, the
    // selection tooltip or a rich paste.
    enableInputRules: false,
    enablePasteRules: false,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Letter",
        "aria-multiline": "true",
        spellcheck: "true",
      },
      handleKeyDown(view, event) {
        if (view.composing || event.isComposing) return false;
        const mod = event.metaKey || event.ctrlKey;
        if (!mod) return false;
        const key = event.key.toLowerCase();
        // Holding ⌘Z would otherwise unwind the entire history in a blink.
        if ((key === "z" || key === "y") && event.repeat) return true;
        if (key === "k" && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          openLink();
          return true;
        }
        return false;
      },
      handlePaste(view, event) {
        const files = imageFiles(event.clipboardData?.files);
        if (!files.length || htmlHasText(event.clipboardData.getData("text/html"))) return false;
        event.preventDefault();
        insertImages(files);
        return true;
      },
      handleDrop(view, event, slice, moved) {
        const files = imageFiles(event.dataTransfer?.files);
        if (moved || !files.length) return false;
        event.preventDefault();
        insertImages(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
        return true;
      },
      clipboardTextParser(text, $context, plain, view) {
        const { schema } = view.state;
        return Slice.maxOpen(Fragment.fromArray(plainTextContent(text).map((node) => schema.nodeFromJSON(node))));
      },
      handleDoubleClickOn(view, pos, node) {
        if (node.type.name !== "image") return false;
        const alt = window.prompt("Describe this photo (for screen readers):", node.attrs.alt || "");
        if (alt !== null) {
          view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, alt: alt.trim() }));
        }
        return true;
      },
    },
    onCreate({ editor: created }) {
      // StrictMode builds and destroys a throwaway editor first; Tiptap still
      // fires its create event afterwards.
      // This fires late, so only take focus if nothing has it yet: someone may
      // already be typing in the letter or in a detail like the date.
      const focused = document.activeElement && document.activeElement !== document.body;
      if (created.isDestroyed || focused || draft?.doc) return;
      if (!window.matchMedia("(pointer: fine)").matches) return;
      // A fresh letter opens with the caret on the blank line under "Dear …,".
      created.chain().focus().setTextSelection(created.state.doc.firstChild.nodeSize + 1).run();
    },
    onUpdate({ editor: updated }) {
      importRemoteImages(updated);
      scheduleSave();
    },
  });
  editorRef.current = editor;

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      strike: current.isActive("strike"),
      link: current.isActive("link"),
      quote: current.isActive("blockquote"),
    }),
  });

  // The tooltip only joins the page once shown, so show it first, then focus
  // the field the link editor starts in.
  const linkMode = link?.mode;
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const { selection } = editor.state;
    const meta = linkMode ? "show" : selection.empty ? "hide" : "updatePosition";
    editor.view.dispatch(editor.state.tr.setMeta(BUBBLE_KEY, meta));
    if (linkMode) (linkMode === "insert" ? labelInputRef : urlInputRef).current?.focus();
  }, [editor, linkMode]);

  useEffect(() => {
    scheduleSave();
  }, [fields, recipient, scheduleSave]);

  // Everyone who already has a page, for the "for" field's suggestions.
  useEffect(() => {
    fetch("/api/recipients", { headers: { "x-write-key": WRITE_KEY } })
      .then((response) => (response.ok ? response.json() : { recipients: [] }))
      .then((data) => setRecipients(data.recipients || []))
      .catch(() => {});
  }, []);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const setField = (name, value) => {
    if (name === "date") dateTouched.current = true;
    if (name === "to") {
      // Keep the salutation in step while it's still the untouched default.
      const first = editor.state.doc.firstChild;
      if (first?.textContent === `Dear ${fields.to},`) {
        editor.view.dispatch(editor.state.tr.insertText(`Dear ${value},`, 1, 1 + first.content.size));
      }
    }
    setFields((current) => ({ ...current, [name]: value }));
  };

  const cycleStamp = () => {
    const index = STAMP_LIBRARY.findIndex((stamp) => stamp.name === fields.stamp);
    setField("stamp", STAMP_LIBRARY[(index + 1) % STAMP_LIBRARY.length].name);
  };

  const fail = (message) => setStatus({ kind: "error", message });

  const send = async () => {
    const photos = imageNodes(editor.state.doc).map(({ node }) => node.attrs);
    const slug = recipientSlug(recipient);
    if (!isRecipientSlug(slug)) return fail("Who's it for? Add their name next to Send.");
    if (!fields.date) return fail("Pick a date for the letter.");
    if (photos.some((attrs) => attrs.unresolved)) {
      return fail("One photo couldn't be copied (it's outlined in red). Delete it and paste the image on its own.");
    }
    if (photos.some((attrs) => !attrs.imageId)) return fail("Hang on, a photo is still copying in.");
    if (!editor.state.doc.textContent.trim()) return fail("The letter is empty.");
    if (!photos.length) return fail("Paste in a photo. The topmost one goes on the front of the postcard.");

    setStatus({ kind: "sending" });
    editor.setEditable(false);
    try {
      // A photo pasted a moment ago may still be shrinking; wait rather than refuse.
      await Promise.all(preparing.current.values());
      const used = [...new Set(photos.map((attrs) => attrs.imageId))];
      const encoded = await Promise.all(
        used.map(async (id) => {
          const { blob } = images.get(id);
          return [id, { type: blob.type, data: await blobToBase64(blob) }];
        }),
      );
      const response = await fetch("/api/letters", {
        method: "POST",
        headers: { "content-type": "application/json", "x-write-key": WRITE_KEY },
        body: JSON.stringify({
          recipient: slug,
          fields,
          document: editor.getJSON(),
          images: Object.fromEntries(encoded),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The letter couldn't be sent. Try again in a moment.");

      localStorage.setItem(RECIPIENT_KEY, result.recipient);
      window.clearTimeout(saveTimer.current);
      await clearDraft();
      setSentTo(result);
      setStatus({ kind: "sent" });
    } catch (error) {
      editor.setEditable(true);
      fail(
        error instanceof TypeError
          ? "Couldn't reach the server. Your letter is still here; try again."
          : error.message,
      );
    }
  };

  const sending = status.kind === "sending";
  const typedSlug = recipientSlug(recipient);
  const newPage = isRecipientSlug(typedSlug) && !recipients.includes(typedSlug) ? typedSlug : null;
  const sent = status.kind === "sent";
  const locked = sending || sent;
  const stamp = STAMP_LIBRARY.find((entry) => entry.name === fields.stamp) || STAMP_LIBRARY[0];
  const formatButtons = [
    { label: "B", title: "Bold (⌘B)", state: active.bold, run: (chain) => chain.toggleBold(), variant: "bold" },
    { label: "I", title: "Italic (⌘I)", state: active.italic, run: (chain) => chain.toggleItalic(), variant: "italic" },
    { label: "S", title: "Strikethrough (⌘⇧S)", state: active.strike, run: (chain) => chain.toggleStrike(), variant: "strike" },
    { label: "“ ”", title: "Quote (⌘⇧B)", state: active.quote, run: (chain) => chain.toggleBlockquote() },
  ];

  const linkKeys = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeLink();
    }
  };



  return (
    <>
      <Card aria-label="Letter to send">
        <DividerImprint aria-hidden="true">{POSTCARD_IMPRINT}</DividerImprint>
        <Body>
          <Address>
            <Inked>
              <PostageAddress
                postcard={{ recipient: fields.to, from: fields.from, stamps: stamp ? [stamp] : [] }}
                isMobile
                onEdit={locked ? undefined : (kind, value) => setField(kind, value)}
                onStampClick={locked ? undefined : cycleStamp}
                postmark={sent ? (stamp?.name === POSTMARK.name ? FALLBACK_POSTMARK : POSTMARK).src : null}
              />
            </Inked>
          </Address>

          <Postdate>
            <InlineField
              display={formatPostdate(fields.date)}
              label="Date"
              disabled={locked}
              onCommit={(text) => {
                const date = parseDate(text);
                if (date) setField("date", date);
              }}
            />
          </Postdate>
          <Location>
            <InlineField
              display={fields.location}
              label="Written at"
              placeholder={DEFAULT_LOCATION}
              disabled={locked}
              onCommit={(text) => setField("location", text)}
            />
          </Location>

          <Editor editor={editor} $sent={sent} />
        </Body>

        {editor && (
          <BubbleMenu
            editor={editor}
            pluginKey={BUBBLE_KEY}
            // On the page itself, so it doesn't take on the letter's ink blending.
            appendTo={() => document.body}
            options={{
              placement: window.matchMedia("(pointer: coarse)").matches ? "bottom" : "top",
              offset: 8,
            }}
            shouldShow={({ editor: current, state }) => {
              if (linkOpen.current) return true;
              const { selection } = state;
              if (selection.empty || selection instanceof NodeSelection || !current.isEditable) return false;
              return Boolean(state.doc.textBetween(selection.from, selection.to, " ").trim());
            }}
          >
            <Bubble role="toolbar" aria-label="Formatting">
              {link ? (
                <LinkForm
                  onSubmit={(event) => {
                    event.preventDefault();
                    applyLink();
                  }}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) closeLink();
                  }}
                >
                  {link.mode !== "selection" && (
                    <LinkInput
                      ref={labelInputRef}
                      aria-label="Link text"
                      placeholder="text"
                      value={link.label}
                      onChange={(event) => setLink({ ...link, label: event.target.value })}
                      onKeyDown={(event) => {
                        linkKeys(event);
                        // Enter in the label moves on to the URL rather than submitting.
                        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          urlInputRef.current?.focus();
                        }
                      }}
                    />
                  )}
                  <LinkInput
                    ref={urlInputRef}
                    aria-label="Link URL"
                    aria-invalid={Boolean(link.error)}
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    placeholder={link.mode === "edit" ? "clear to unlink" : "paste a link"}
                    value={link.href}
                    onChange={(event) => {
                      urlEdited.current = true;
                      setLink({ ...link, href: event.target.value, error: "" });
                    }}
                    onKeyDown={linkKeys}
                  />
                  {link.error && <LinkError role="alert">{link.error}</LinkError>}
                  {/* Two fields need a submit button for Enter to submit the form. */}
                  <button type="submit" hidden />
                </LinkForm>
              ) : (
                <>
                  {formatButtons.map(({ label, title, state, run, variant }) => (
                    <BubbleButton
                      key={title}
                      type="button"
                      title={title}
                      aria-label={title}
                      aria-pressed={Boolean(state)}
                      $variant={variant}
                      // Keep the selection when a button is tapped or clicked.
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => run(editor.chain().focus()).run()}
                    >
                      {label}
                    </BubbleButton>
                  ))}
                  <BubbleButton
                    type="button"
                    title="Link (⌘K)"
                    aria-label="Link (⌘K)"
                    aria-pressed={active.link}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={openLink}
                  >
                    link
                  </BubbleButton>
                </>
              )}
            </Bubble>
          </BubbleMenu>
        )}
      </Card>

      <Footer>
        {sent ? (
          <>
            <StatusText role="status">
              Sent. It's waiting at <a href={sentTo.url}>{window.location.host}{sentTo.url}</a>.
            </StatusText>
            <FooterActions>
              <TextButton as="a" href={sentTo.url}>see their stack</TextButton>
              <SendButton type="button" onClick={onStartOver}>write another</SendButton>
            </FooterActions>
          </>
        ) : (
          <SendRow>
            <RecipientField>
              <span aria-hidden="true">for</span>
              <input
                aria-label="Who it's for"
                list="recipients"
                value={recipient}
                placeholder="someone"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={sending}
                onChange={(event) => setRecipient(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && !event.nativeEvent.isComposing && send()}
              />
              <datalist id="recipients">
                {recipients.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </RecipientField>
            <SendButton type="button" onClick={send} disabled={sending}>
              {sending ? "sending…" : "send"}
            </SendButton>
          </SendRow>
        )}
        {!sent && newPage && <Hint>a new page: /{newPage}</Hint>}
        {/* Below the button, so a message never pushes it out from under you.
            Keyed so each new message plays its entrance. */}
        {status.kind === "error" && (
          <StatusText key={status.message} role="status" $error>
            {status.message}
          </StatusText>
        )}
      </Footer>
    </>
  );
}

const ink = "#3c281f";
const rust = "#7b4229";

const GlobalStyle = createGlobalStyle`
  ${fontFaces}

  *, *::before, *::after {
    box-sizing: border-box;
  }

  html {
    background: #8f908d;
    /* Our own press states stand in for the grey flash on tap. */
    -webkit-tap-highlight-color: transparent;
  }

  body {
    margin: 0;
    min-width: 320px;
    color: ${ink};
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  button, input {
    font: inherit;
    color: inherit;
  }
`;

const Page = styled.main`
  min-height: 100vh;
  padding: clamp(28px, 8vh, 72px) clamp(28px, 8vw, 48px) 64px;
  background:
    url("/textures/subtle-grunge.png"),
    url("/textures/tactile-noise-light.png"),
    linear-gradient(135deg, #a3a39f 0%, #858681 48%, #70716c 100%);
  background-blend-mode: multiply, soft-light, normal;
  background-attachment: fixed;
`;

// The back of the postcard as it reads on a phone, at any screen size.
const Card = styled.article`
  ${mobileLetterInsets}
  ${paperBack}
  ${mobilePaperShadow}
  position: relative;
  max-width: 584px;
  min-height: min(78vh, 820px);
  margin: 0 auto;
  padding: var(--mobile-letter-inset-y) var(--mobile-letter-inset-x);
  border-radius: 5px;
`;

const DividerImprint = styled.div`
  ${imprintText}
  position: absolute;
  top: 50%;
  right: 16px;
  z-index: 3;
  white-space: nowrap;
  pointer-events: none;
  writing-mode: vertical-rl;
  transform: translateY(-50%);
`;

// The ink effect is applied to each printed piece rather than the whole body,
// so the editing slips above them stay opaque.
const Body = styled.div`
  ${mobileLetterBody}
  ${letterType}
  ${mobileLetterText}
`;

const Inked = styled.div`
  ${letterInk}
`;

const Address = styled.div`
  ${mobileAddressFloat}
  position: relative;
  z-index: 4;
`;

const Postdate = styled.div`
  ${mobilePostdate}
  ${letterInk}
  margin-bottom: 0;
`;

const Location = styled.div`
  ${imprintText}
  ${letterInk}
  /* flow-root keeps this beside the stamp rather than wrapping under it. */
  display: flow-root;
  margin: 2px 0 18px;
  font-size: 0.64rem;
  line-height: 1.4;
`;

const Editor = styled(EditorContent)`
  ${letterInk}
  ${({ $sent }) => $sent && "opacity: 0.5;"}
  transition: opacity 0.2s ease;

  .ProseMirror {
    min-height: 40vh;
    outline: none;
  }

  li p {
    margin: 0;
  }

  img {
    ${mediaImage}
    clear: both;
    cursor: pointer;
  }

  img.ProseMirror-selectednode {
    outline: 2px solid ${rust};
    outline-offset: 3px;
  }

  img[data-unresolved] {
    min-height: 60px;
    outline: 2px solid #b3261e;
    outline-offset: 2px;
  }
`;

const bubbleIn = keyframes`
  from {
    opacity: 0;
  }
`;

// The menu is re-added to the page each time it shows, which replays this.
// A quick fade only: it appears on every selection, so no movement.
const Bubble = styled.div`
  animation: ${bubbleIn} 120ms ease-out;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 8px;
  background: rgba(45, 29, 23, 0.94);
  color: #f6efe1;
  font-family: "Oceanside Typewriter", "Courier New", monospace;
  box-shadow: 0 10px 24px rgba(20, 12, 8, 0.28);
`;

const BubbleButton = styled.button`
  min-width: 34px;
  height: 32px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background-color 0.15s ease;

  ${({ $variant }) =>
    ({
      bold: css`font-weight: bold;`,
      italic: css`font-style: italic;`,
      strike: css`text-decoration: line-through;`,
    })[$variant]}

  &[aria-pressed="true"] {
    background: rgba(246, 239, 225, 0.2);
  }

  @media (hover: hover) {
    &:hover {
      background: rgba(246, 239, 225, 0.12);
    }
  }

  &:focus-visible {
    outline: 2px solid #f6efe1;
    outline-offset: -2px;
  }
`;

const LinkForm = styled.form`
  display: grid;
  gap: 4px;
  width: min(280px, 76vw);
`;

const LinkInput = styled.input`
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: rgba(246, 239, 225, 0.12);
  color: #f6efe1;
  font-size: max(16px, 0.9rem);
  outline: none;

  &::placeholder {
    color: rgba(246, 239, 225, 0.5);
  }

  &:focus-visible {
    background: rgba(246, 239, 225, 0.2);
  }
`;

const LinkError = styled.p`
  margin: 0 4px 2px;
  font-size: 0.72rem;
  color: #ffb4a6;
`;

const Footer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  max-width: 584px;
  margin: 28px auto 0;
  text-align: center;
  font-family: "Oceanside Typewriter", "Courier New", monospace;
`;

const statusIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(4px);
  }
`;

const statusFade = keyframes`
  from {
    opacity: 0;
  }
`;

const StatusText = styled.p`
  animation: ${statusIn} 150ms cubic-bezier(0.23, 1, 0.32, 1);
  margin: 0;

  @media (prefers-reduced-motion: reduce) {
    animation-name: ${statusFade};
  }

  max-width: 420px;
  font-size: 0.8rem;
  line-height: 1.5;
  color: ${({ $error }) => ($error ? "#5b1408" : "#f6efe1")};
  ${({ $error }) =>
    $error &&
    css`
      padding: 8px 12px;
      border-radius: 6px;
      background: rgba(250, 247, 240, 0.9);
    `}
`;

const FooterActions = styled.div`
  display: flex;
  align-items: center;
  gap: 20px;
`;

const SendButton = styled.button`
  min-width: 140px;
  height: 46px;
  padding: 0 24px;
  border: none;
  border-radius: 4px;
  background: ${rust};
  color: #f6efe1;
  font-family: "Oceanside Typewriter", "Courier New", monospace;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 0 6px 14px rgba(40, 24, 16, 0.3);
  transition: transform 0.15s ease, opacity 0.15s ease;

  &:active:not(:disabled) {
    transform: scale(0.97);
  }

  &:focus-visible {
    outline: 2px solid #f6efe1;
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;

const TextButton = styled.button`
  padding: 0;
  border: none;
  background: none;
  ${postmarkInk}
  color: rgba(246, 239, 225, 0.75);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-decoration: underline;
  text-underline-offset: 0.2em;
  cursor: pointer;
`;

const SendRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 14px 18px;
`;

const RecipientField = styled.label`
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: #f6efe1;
  font-family: "Oceanside Typewriter", "Courier New", monospace;
  font-size: 0.85rem;

  input {
    width: 10ch;
    min-width: 0;
    padding: 2px 0 4px;
    border: none;
    border-bottom: 1px solid rgba(246, 239, 225, 0.5);
    border-radius: 0;
    background: transparent;
    color: #fbf8f1;
    font-family: "Biro Script", "Segoe Print", cursive;
    /* 16px keeps iOS from zooming in on focus. */
    font-size: max(16px, 1.25rem);
    outline: none;
    transition: border-color 0.15s ease;

    &::placeholder {
      color: rgba(246, 239, 225, 0.45);
    }

    &:focus-visible {
      border-bottom-color: #fbf8f1;
    }
  }
`;

const Hint = styled.p`
  margin: -6px 0 0;
  color: rgba(246, 239, 225, 0.7);
  font-family: "DIY", "Courier New", monospace;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
`;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
