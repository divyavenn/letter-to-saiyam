import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styled, { createGlobalStyle, keyframes } from "styled-components";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
} from "motion/react";

const markdownFiles = import.meta.glob("./letters/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});
const stampFiles = import.meta.glob("./stamps/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

const POSTCARD_HEIGHT = 383;
const POSTCARD_HEIGHT_MOBILE = 210;
// Vertical gap between stacked cards. Must exceed half the card height so that a
// card sandwiched between two raised neighbours still peeks through (2 * gap > card height).
const POSTCARD_ITEM_SIZE = 220;
const POSTCARD_SCALE_OFFSETS = [1, 0.995, 0.99, 0.985, 0.98];
// Buried cards are nudged sideways and tilted by a per-card random amount
// (deterministic, derived from the slug) so they fan out and stay legible.
const POSTCARD_MAX_JITTER_X = 40;
const POSTCARD_MAX_JITTER_ROTATE = 3;
const IMAGE_FOLDER = "/images/";
const FALLBACK_POSTCARD_IMAGE = "pressed-flower.png";
const BG_MUSIC_VIDEO_ID = "R-bI0AhSyU0";
const POSTCARD_IMPRINT =
  "GENUINE POST CARD ISSUED BY D. VENN, FROWNED UPON BY UNCLE SAM, NO POSTAGE REQ.";
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "mov", "m4v"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"]);
const STAMP_LIBRARY = Object.entries(stampFiles)
  .map(([path, src]) => ({
    name: path.split("/").pop(),
    src,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

function parseFrontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);

  if (!match) {
    return { fields: {}, body: source.trim() };
  }

  const fields = match[1].split("\n").reduce((acc, line) => {
    const separator = line.indexOf(":");

    if (separator === -1) {
      return acc;
    }

    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    return { ...acc, [key]: value };
  }, {});

  return {
    fields,
    body: source.slice(match[0].length).trim(),
  };
}

function parseList(value) {
  if (!value) {
    return [];
  }

  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function hashString(value) {
  return [...value].reduce(
    (hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0,
    2166136261,
  );
}

function isExternalUrl(value) {
  return /^(https?:)?\/\//.test(value) || value.startsWith("data:");
}

function resolveImageSource(value) {
  if (!value) {
    return `${IMAGE_FOLDER}${FALLBACK_POSTCARD_IMAGE}`;
  }

  if (isExternalUrl(value) || value.startsWith("/")) {
    return value;
  }

  return `${IMAGE_FOLDER}${value.replace(/^images\//, "")}`;
}

function resolveMediaSource(value) {
  if (!value || isExternalUrl(value) || value.startsWith("/")) {
    return value;
  }

  return resolveImageSource(value);
}

function getExtension(value = "") {
  return value.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase() || "";
}

function isVideoSource(value) {
  return VIDEO_EXTENSIONS.has(getExtension(value));
}

function isImageSource(value) {
  return IMAGE_EXTENSIONS.has(getExtension(value));
}

function resolveStampList(fields, fallbackSeed) {
  const requested = [
    ...parseList(fields.stamps),
    ...parseList(fields.stampImages),
    ...parseList(fields.stampImage),
    ...parseList(fields.stamp),
  ];

  const resolved = requested
    .map((name) => {
      const fileName = name.split("/").pop();
      const match = STAMP_LIBRARY.find((stamp) => stamp.name === fileName);

      if (!match && (isExternalUrl(name) || name.startsWith("/"))) {
        return { name: fileName || name, src: name };
      }

      return match;
    })
    .filter(Boolean);

  if (resolved.length > 0 || STAMP_LIBRARY.length === 0) {
    return resolved;
  }

  return [STAMP_LIBRARY[hashString(fallbackSeed) % STAMP_LIBRARY.length]];
}

function getRecipient(fields, body) {
  if (fields.to || fields.recipient) {
    return fields.to || fields.recipient;
  }

  const salutation = body.match(/^\s*Dear\s+([^,\n]+),/m);

  return salutation ? salutation[1].trim() : "";
}

function loadPostcards() {
  return Object.entries(markdownFiles)
    .map(([path, source]) => {
      const { fields, body } = parseFrontmatter(source);
      const slug = path.split("/").pop().replace(/\.md$/, "");
      const seed = `${slug}:${fields.date || ""}`;

      return {
        id: slug,
        date: fields.date || "1970-01-01",
        order: Number(fields.order) || 0,
        recipient: getRecipient(fields, body),
        from: fields.from || "",
        location: fields.location || "somewhere on a lonely blue planet",
        image: resolveImageSource(fields.image),
        stamps: resolveStampList(fields, seed),
        body,
      };
    })
    .sort((a, b) => {
      if (a.order || b.order) {
        return b.order - a.order;
      }

      return new Date(b.date) - new Date(a.date);
    })
    .map((postcard, index) => {
      // Random magnitude (fresh each load), with the sign alternating per card
      // so neighbours lean opposite ways and fan out.
      const sign = index % 2 === 0 ? 1 : -1;

      return {
        ...postcard,
        jitterX:
          sign * (0.5 + Math.random() * 0.5) * POSTCARD_MAX_JITTER_X,
        jitterRotate:
          sign * (0.5 + Math.random() * 0.5) * POSTCARD_MAX_JITTER_ROTATE,
      };
    });
}

function formatPostcardDate(value) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  return new Date(year, month - 1, day).toLocaleDateString();
}

// --- Audio bus ---------------------------------------------------------------
// One place that owns every sound so motion can be timed to it and a single
// mute governs music, ambient room-tone and the paper SFX together.
const MUSIC_VOLUME = 30;

const SFX = {
  flip: { src: "/sounds/flip.mp3", duration: 0.42, el: null },
  move: { src: "/sounds/move.mp3", duration: 0.5, el: null },
};

const clampDuration = (value) => Math.min(1.2, Math.max(0.32, value));

const audioBus = {
  muted: true,
  player: null,
  ambient: null,
  ctx: null,
  fadeRaf: 0,
  durationListeners: new Set(),

  init() {
    if (typeof Audio === "undefined" || SFX.flip.el) {
      return;
    }
    ["flip", "move"].forEach((key) => {
      const el = new Audio(SFX[key].src);
      el.preload = "auto";
      el.addEventListener("loadedmetadata", () => {
        if (Number.isFinite(el.duration) && el.duration > 0) {
          SFX[key].duration = el.duration;
          this.durationListeners.forEach((fn) => fn());
        }
      });
      SFX[key].el = el;
    });
  },

  onDurations(fn) {
    this.durationListeners.add(fn);
    return () => this.durationListeners.delete(fn);
  },

  playSfx(key) {
    // SFX always play, regardless of the music mute toggle
    if (!SFX[key].el) {
      return;
    }
    try {
      const el = SFX[key].el.cloneNode();
      el.volume = 0.4 + Math.random() * 0.22; // 0.40–0.62
      el.playbackRate = 0.78 + Math.random() * 0.44; // 0.78–1.22, wide pitch swing
      el.play().catch(() => {});
    } catch {
      /* ignore */
    }
  },

  playFlip() {
    this.playSfx("flip");
    this.duck(SFX.flip.duration);
  },

  playMove() {
    this.playSfx("move");
    this.duck(SFX.move.duration);
  },

  setPlayer(player) {
    this.player = player;
  },

  getAudioCtx() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      return null;
    }
    if (!this.ctx) {
      this.ctx = new Ctx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  },

  resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  },

  startAmbient() {
    // independent of the music mute — the room tone is always part of the space
    if (this.ambient) {
      return;
    }
    const ctx = this.getAudioCtx();
    if (!ctx) {
      return;
    }
    // soft brown-noise room tone, gently low-passed
    const len = Math.floor(ctx.sampleRate * 4);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 520;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.045, now + 2.5);
    source.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    this.ambient = { gain, source };
  },

  fadeMusicTo(target, ms) {
    const player = this.player;
    if (!player?.setVolume) {
      return;
    }
    let start = target;
    try {
      start = player.getVolume();
    } catch {
      /* ignore */
    }
    const t0 = performance.now();
    cancelAnimationFrame(this.fadeRaf);
    const step = (t) => {
      const k = ms <= 0 ? 1 : Math.min(1, (t - t0) / ms);
      try {
        player.setVolume(start + (target - start) * k);
      } catch {
        /* ignore */
      }
      if (k < 1) {
        this.fadeRaf = requestAnimationFrame(step);
      }
    };
    this.fadeRaf = requestAnimationFrame(step);
  },

  duck(seconds) {
    const player = this.player;
    if (this.muted || !player?.setVolume) {
      return;
    }
    try {
      player.setVolume(MUSIC_VOLUME * 0.45);
    } catch {
      /* ignore */
    }
    this.fadeMusicTo(MUSIC_VOLUME, Math.max(400, seconds * 1000));
  },

  setMuted(next) {
    // only governs the YouTube music; ambient + SFX are independent
    this.muted = next;
    const player = this.player;
    try {
      if (next) {
        player?.mute?.();
      } else {
        player?.setVolume?.(0);
        player?.unMute?.();
        player?.playVideo?.();
        this.fadeMusicTo(MUSIC_VOLUME, 1500);
      }
    } catch {
      /* ignore */
    }
  },
};

function useSfxDurations() {
  const [durations, setDurations] = useState({
    flip: clampDuration(SFX.flip.duration),
    move: clampDuration(SFX.move.duration),
  });

  useEffect(() => {
    audioBus.init();
    const update = () =>
      setDurations({
        flip: clampDuration(SFX.flip.duration),
        move: clampDuration(SFX.move.duration),
      });
    update();
    return audioBus.onDurations(update);
  }, []);

  return durations;
}

// --- Background music (hidden YouTube player) ------------------------------
let ytApiPromise = null;

function loadYouTubeApi() {
  if (window.YT && window.YT.Player) {
    return Promise.resolve(window.YT);
  }

  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve(window.YT);
      };
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    });
  }

  return ytApiPromise;
}

function SpeakerIcon({ muted }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* speaker body */}
      <path
        d="M2 9 H6 L11 4 V20 L6 15 H2 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* sound waves — shown when playing */}
      <motion.g
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
        initial={false}
        animate={{ opacity: muted ? 0 : 1, scale: muted ? 0.5 : 1 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        style={{ transformOrigin: "13px 12px" }}
      >
        <path d="M14.5 9.2a3.8 3.8 0 0 1 0 5.6" />
        <path d="M17.2 6.6a7.6 7.6 0 0 1 0 10.8" />
      </motion.g>
      {/* cross — shown when muted */}
      <motion.g
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        initial={false}
        animate={{ opacity: muted ? 1 : 0, scale: muted ? 1 : 0.5 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        style={{ transformOrigin: "18px 12px" }}
      >
        <line x1="15.5" y1="9.5" x2="20.5" y2="14.5" />
        <line x1="20.5" y1="9.5" x2="15.5" y2="14.5" />
      </motion.g>
    </svg>
  );
}

function BackgroundMusic({ videoId }) {
  const containerRef = useRef(null);
  const createdRef = useRef(false);
  const [muted, setMutedState] = useState(true);

  const applyMuted = useCallback((next) => {
    audioBus.setMuted(next);
    setMutedState(next);
  }, []);

  // build the ambient bed up front (cheap; stays suspended until a gesture)
  useEffect(() => {
    audioBus.startAmbient();
  }, []);

  // Preload the YouTube player during idle time — after the page has painted,
  // so it stays off the critical path, but ready (muted, buffered) before the
  // first click so music starts the instant the visitor interacts.
  useEffect(() => {
    const create = () => {
      if (createdRef.current) {
        return;
      }
      createdRef.current = true;

      loadYouTubeApi().then((YT) => {
        if (!containerRef.current) {
          return;
        }

        new YT.Player(containerRef.current, {
          videoId,
          playerVars: {
            autoplay: 1,
            loop: 1,
            playlist: videoId,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            playsinline: 1,
          },
          events: {
            onReady: (event) => {
              audioBus.setPlayer(event.target);
              event.target.playVideo();
              // honour the current choice (muted until the first gesture)
              audioBus.setMuted(audioBus.muted);
            },
          },
        });
      });
    };

    let idleId;
    if (typeof requestIdleCallback === "function") {
      idleId = requestIdleCallback(create, { timeout: 2000 });
    } else {
      idleId = setTimeout(create, 1200);
    }

    return () => {
      if (typeof cancelIdleCallback === "function" && idleId != null) {
        cancelIdleCallback(idleId);
      } else {
        clearTimeout(idleId);
      }
    };
  }, [videoId]);

  // first interaction → resume audio + unmute the (already-loaded) music
  useEffect(() => {
    const onFirstGesture = () => {
      audioBus.resume();
      applyMuted(false);
      window.removeEventListener("pointerdown", onFirstGesture);
    };
    window.addEventListener("pointerdown", onFirstGesture);
    return () => window.removeEventListener("pointerdown", onFirstGesture);
  }, [applyMuted]);

  return (
    <>
      <MusicFrame ref={containerRef} aria-hidden="true" />
      <MuteButton
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          applyMuted(!muted);
        }}
        aria-label={muted ? "Unmute music" : "Mute music"}
        title={muted ? "Unmute music" : "Mute music"}
      >
        <SpeakerIcon muted={muted} />
      </MuteButton>
    </>
  );
}

function App() {
  // postcards are sorted most-recent-first; this fixed order is the vertical stack.
  const postcards = useMemo(loadPostcards, []);
  const [raisedId, setRaisedId] = useState(() => postcards[0]?.id ?? null);
  const [openId, setOpenId] = useState(null);
  const sfx = useSfxDurations();

  const total = postcards.length;
  const stageHeight = POSTCARD_HEIGHT + POSTCARD_ITEM_SIZE * (total - 1) + 48;
  const mobileStageHeight =
    POSTCARD_HEIGHT_MOBILE + POSTCARD_ITEM_SIZE * (total - 1) + 48;

  // freeze the idle animations when the tab isn't visible
  useEffect(() => {
    const sync = () => {
      if (document.hidden) {
        document.documentElement.setAttribute("data-hidden", "");
      } else {
        document.documentElement.removeAttribute("data-hidden");
      }
    };
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const handleActivate = (id) => {
    if (id === raisedId) {
      // already at the front → flip it over
      audioBus.playFlip();
      setOpenId((current) => (current === id ? null : id));
    } else {
      // buried → flip any open card back, then lift this one to the front (in place)
      audioBus.playMove();
      setOpenId(null);
      setRaisedId(id);
    }
  };

  const handleBackgroundClick = () => {
    if (openId) {
      audioBus.playFlip();
    }
    setOpenId(null);
  };

  return (
    <>
      <GlobalStyle />
      <BackgroundMusic videoId={BG_MUSIC_VIDEO_ID} />
      <Desktop onClick={handleBackgroundClick}>
        <Vignette aria-hidden="true" />
        <StackRail
          aria-label="Postcard letters"
          style={{
            "--postcard-stage-height": `${stageHeight}px`,
            "--postcard-stage-height-mobile": `${mobileStageHeight}px`,
          }}
        >
          <AnimatePresence initial={false}>
            {postcards.map((postcard, index) => (
              <Postcard
                key={postcard.id}
                postcard={postcard}
                stackPos={index}
                total={total}
                isRaised={raisedId === postcard.id}
                isOpen={openId === postcard.id}
                flipDuration={sfx.flip}
                moveDuration={sfx.move}
                onActivate={() => handleActivate(postcard.id)}
              />
            ))}
          </AnimatePresence>
        </StackRail>
      </Desktop>
    </>
  );
}

function Postcard({
  postcard,
  stackPos,
  total,
  isRaised,
  isOpen,
  flipDuration,
  moveDuration,
  onActivate,
}) {
  const depth = Math.min(stackPos, POSTCARD_SCALE_OFFSETS.length - 1);
  const baseY = stackPos * POSTCARD_ITEM_SIZE;
  // Spatial slot (y) is fixed by date. Buried cards fan out with a random sideways
  // nudge + tilt; the lifted card straightens, centers, scales up and shadows deeper.
  const x = isRaised ? 0 : postcard.jitterX;
  const y = isRaised ? baseY - 16 : baseY;
  const rotate = isRaised ? 0 : postcard.jitterRotate;
  const scale = isRaised ? 1.035 : POSTCARD_SCALE_OFFSETS[depth];
  // two-layer shadow: tight contact + soft ambient, both deeper when lifted
  const filter = isRaised
    ? "drop-shadow(0 30px 44px rgba(20, 12, 8, 0.40)) drop-shadow(0 8px 14px rgba(20, 12, 8, 0.26))"
    : "drop-shadow(0 6px 10px rgba(20, 12, 8, 0.22)) drop-shadow(0 2px 3px rgba(20, 12, 8, 0.16))";
  const zIndex = isOpen
    ? total + 20
    : isRaised
      ? total + 10
      : total - stackPos;

  // hover parallax tilt — only the lifted card, pointer devices, motion allowed
  const tiltX = useMotionValue(0);
  const tiltY = useMotionValue(0);
  const rotateX = useSpring(tiltX, { stiffness: 150, damping: 18 });
  const rotateY = useSpring(tiltY, { stiffness: 150, damping: 18 });

  const handlePointerMove = (event) => {
    if (!isRaised || event.pointerType === "touch") {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    tiltY.set(px * 9);
    tiltX.set(-py * 7);
  };

  const resetTilt = () => {
    tiltX.set(0);
    tiltY.set(0);
  };

  const ease = [0.22, 1, 0.36, 1];
  const moveTransition = { duration: moveDuration, ease };

  // entrance: each card "arrives" with a staggered drop + fade, mount-only
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const entranceDelay = mounted ? 0 : 0.15 + stackPos * 0.22;
  const entranceTransition = {
    duration: mounted ? moveDuration : 0.9,
    ease,
    delay: entranceDelay,
  };

  return (
    <PostcardShell
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
      style={{ zIndex, rotateX, rotateY }}
      initial={{ opacity: 0, y: baseY + 70, scale: scale * 0.9 }}
      animate={{ opacity: 1, x, y, rotate, scale, filter }}
      exit={{ opacity: 0 }}
      transition={{
        opacity: {
          duration: mounted ? 0.4 : 0.9,
          delay: entranceDelay,
          ease: "easeOut",
        },
        filter: moveTransition,
        x: moveTransition,
        rotate: moveTransition,
        y: entranceTransition,
        scale: entranceTransition,
      }}
    >
      <FlipCard
        as={motion.article}
        $open={isOpen}
        animate={{ rotateY: isOpen ? 180 : 0 }}
        transition={{ duration: flipDuration, ease: [0.4, 0, 0.2, 1] }}
        aria-label={`Postcard to ${postcard.recipient || "you"}, ${isOpen ? "letter back" : "postcard front"}`}
      >
        <PostcardFace $front>
          <PostcardImage
            src={postcard.image}
            alt={`Postcard to ${postcard.recipient || "you"}, front`}
          />
        </PostcardFace>

        <PostcardFace $back>
          {postcard.stamps.length > 0 && (
            <StampLayer>
              {postcard.stamps.map((stamp, stampIndex) => (
                <Stamp key={`${stamp.name}-${stampIndex}`} $index={stampIndex}>
                  <StampImage src={stamp.src} alt={stamp.name} />
                </Stamp>
              ))}
            </StampLayer>
          )}
          <LocationImprint>{postcard.location}</LocationImprint>
          <PostcardBack>
            <BackColumns>
              <Correspondence onClick={(event) => event.stopPropagation()}>
                <LetterBody>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      img: MarkdownImage,
                      a: MarkdownLink,
                    }}
                  >
                    {postcard.body}
                  </ReactMarkdown>
                </LetterBody>
              </Correspondence>
              <AddressColumn>
                <DividerImprint>{POSTCARD_IMPRINT}</DividerImprint>
                <AddressBlock>
                  {postcard.recipient && (
                    <Recipient>to {postcard.recipient}</Recipient>
                  )}
                  {postcard.from && (
                    <AddressLine>from {postcard.from}</AddressLine>
                  )}
                </AddressBlock>
                <Postdate>{formatPostcardDate(postcard.date)}</Postdate>
              </AddressColumn>
            </BackColumns>
          </PostcardBack>
        </PostcardFace>
      </FlipCard>
    </PostcardShell>
  );
}

function MarkdownImage({ src = "", alt = "" }) {
  const resolvedSrc = resolveMediaSource(src);

  if (isVideoSource(resolvedSrc)) {
    return (
      <MarkdownVideo controls playsInline preload="metadata" aria-label={alt || undefined}>
        <source src={resolvedSrc} />
      </MarkdownVideo>
    );
  }

  return <MarkdownMediaImage src={resolvedSrc} alt={alt} loading="lazy" />;
}

function MarkdownLink({ href = "", children, ...props }) {
  const resolvedHref = resolveMediaSource(href);

  if (isVideoSource(resolvedHref)) {
    return (
      <MarkdownVideo controls playsInline preload="metadata">
        <source src={resolvedHref} />
      </MarkdownVideo>
    );
  }

  if (isImageSource(resolvedHref)) {
    const alt = React.Children.toArray(children).join("");

    return <MarkdownMediaImage src={resolvedHref} alt={alt} loading="lazy" />;
  }

  return (
    <MediaLink href={resolvedHref} {...props}>
      {children}
    </MediaLink>
  );
}

const GlobalStyle = createGlobalStyle`
  @font-face {
    font-family: "Biro Script";
    src:
      url("/fonts/biro_script.woff2") format("woff2"),
      url("/fonts/biro_script.ttf") format("truetype");
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }

  @font-face {
    font-family: "Oceanside Typewriter";
    src:
      url("/fonts/oceanside_typewriter.woff2") format("woff2"),
      url("/fonts/oceanside_typewriter.ttf") format("truetype");
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }

  @font-face {
    font-family: "Mom Typewriter";
    src:
      url("/fonts/mom_typewriter.woff2") format("woff2"),
      url("/fonts/mom_typewriter.ttf") format("truetype");
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }

  @font-face {
    font-family: "DIY";
    src:
      url("/fonts/diy.woff2") format("woff2"),
      url("/fonts/diy.ttf") format("truetype");
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  html {
    background: #8f908d;
    scrollbar-width: none;
  }

  html::-webkit-scrollbar,
  body::-webkit-scrollbar,
  *::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  body {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    color: #35251f;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  button {
    font: inherit;
  }

  /* pause every idle animation while the tab is hidden (battery / CPU saver) */
  html[data-hidden] *,
  html[data-hidden] *::before,
  html[data-hidden] *::after {
    animation-play-state: paused !important;
  }
`;

const MusicFrame = styled.div`
  position: fixed;
  left: -9999px;
  top: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
`;

const MuteButton = styled.button`
  position: fixed;
  top: clamp(14px, 2vw, 24px);
  right: clamp(14px, 2vw, 24px);
  z-index: 50;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  color: #ffffff;
  opacity: 0.9;
  transition:
    opacity 0.18s ease,
    transform 0.15s ease;

  &:hover {
    opacity: 1;
  }

  &:active {
    transform: scale(0.88);
  }
`;

const grainDrift = keyframes`
  0% { transform: translate3d(0, 0, 0); }
  20% { transform: translate3d(-2.6%, 1.8%, 0); }
  40% { transform: translate3d(2%, -2.4%, 0); }
  60% { transform: translate3d(-2.2%, -1.6%, 0); }
  80% { transform: translate3d(1.6%, 2.2%, 0); }
  100% { transform: translate3d(0, 0, 0); }
`;

const Desktop = styled.main`
  position: relative;
  min-height: 100vh;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: clamp(40px, 8vh, 96px) clamp(16px, 4vw, 56px);
  background:
    url("/textures/subtle-grunge.png"),
    url("/textures/tactile-noise-light.png"),
    radial-gradient(circle at 24% 18%, rgba(255, 255, 255, 0.22), transparent 20rem),
    radial-gradient(circle at 76% 8%, rgba(63, 64, 62, 0.24), transparent 22rem),
    repeating-linear-gradient(
      88deg,
      rgba(255, 255, 255, 0.04) 0 1px,
      transparent 1px 32px
    ),
    linear-gradient(135deg, #a3a39f 0%, #858681 48%, #70716c 100%);
  background-blend-mode: multiply, soft-light, screen, multiply, soft-light, normal;
  background-attachment: fixed;

  /* faint scanlines (vignette lives on its own breathing layer) */
  &::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background: repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.04) 0 1px,
      transparent 1px 7px
    );
    mix-blend-mode: multiply;
  }

  /* slow-drifting film grain layer */
  &::after {
    content: "";
    position: fixed;
    inset: -10%;
    z-index: 1;
    pointer-events: none;
    background: url("/textures/tactile-noise-light.png");
    background-size: 280px 280px;
    opacity: 0.13;
    mix-blend-mode: overlay;
    will-change: transform;
    animation: ${grainDrift} 20s ease-in-out infinite;
  }
`;

const vignetteBreathe = keyframes`
  /* edges stay pinned (scale never drops below 1); only the clear centre breathes —
     the darkness advances toward, then recedes from, the middle of the page */
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.16); }
`;

const Vignette = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  transform-origin: 50% 40%;
  background: radial-gradient(
    circle at 50% 40%,
    transparent 0,
    rgba(0, 0, 0, 0.08) 38%,
    rgba(0, 0, 0, 0.42) 92%
  );
  mix-blend-mode: multiply;
  will-change: transform;
  animation: ${vignetteBreathe} 11s ease-in-out infinite;
`;

const stackBreathe = keyframes`
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-3px) rotate(0.1deg); }
`;

const StackRail = styled.section`
  position: relative;
  z-index: 10;
  flex: none;
  width: min(100%, 760px);
  height: var(--postcard-stage-height);
  perspective: 1800px;
  transform-origin: 50% 30%;
  /* gentle idle sway so the page is never dead-still */
  animation: ${stackBreathe} 8s ease-in-out infinite;

  @media (max-width: 680px) {
    height: var(--postcard-stage-height-mobile);
  }
`;

const PostcardShell = styled(motion.div)`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  width: min(100%, 680px);
  aspect-ratio: 16 / 9;
  margin: 0 auto;
  transform-origin: 50% 82%;

  &:first-child {
    margin-top: 0;
  }
`;

const FlipCard = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  cursor: ${(props) => (props.$open ? "default" : "pointer")};
  transform-style: preserve-3d;
`;

const PostcardFace = styled.div`
  position: absolute;
  inset: 0;
  overflow: hidden;
  padding: clamp(15px, 3.4vw, 30px);
  border-radius: 5px;
  backface-visibility: hidden;
  background:
    url("/textures/tactile-noise-light.png"),
    url("/textures/cream-paper.png"),
    linear-gradient(135deg, rgba(255, 255, 255, 0.46), transparent 32%),
    #faf7f0;
  background-blend-mode: multiply, soft-light, screen, normal;
  /* paper-thickness edges; the cast shadow lives on the shell (responsive) */
  box-shadow:
    inset 0 1.5px 0 rgba(255, 255, 255, 0.85),
    inset 0 -1.5px 0 rgba(60, 38, 22, 0.2),
    inset 0 -10px 22px rgba(89, 54, 33, 0.08);

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background:
      url("/textures/subtle-grunge.png"),
      linear-gradient(90deg, rgba(94, 57, 36, 0.1), transparent 18% 82%, rgba(94, 57, 36, 0.12));
    background-blend-mode: multiply;
    opacity: 0.32;
  }

  &::after {
    content: none;
  }

  ${(props) =>
    props.$front &&
    `
      padding: clamp(4px, 0.9vw, 8px);
    `}

  ${(props) =>
    props.$back &&
    `
      display: flex;
      flex-direction: column;
      transform: rotateY(180deg);
      background:
        url("/textures/cream-paper.png"),
        url("/textures/textured-paper.png"),
        #faf7f0;
      background-size: auto, 500px 500px, auto;
      background-blend-mode: multiply, soft-light, normal;
    `}
`;

const PostcardImage = styled.img`
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: sepia(0.05) saturate(0.92) contrast(0.98);
`;

const StampLayer = styled.div`
  position: absolute;
  top: clamp(6px, 1.2vw, 12px);
  right: clamp(6px, 1.2vw, 12px);
  z-index: 5;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  pointer-events: none;
`;

const Stamp = styled.div`
  display: grid;
  width: clamp(96px, 18vw, 148px);
  place-items: center;
  opacity: 0.85;
  mix-blend-mode: multiply;
  transform: ${(props) =>
    `translateX(${props.$index * -20}px) rotate(${props.$index % 2 ? -3 : 2}deg)`};
`;

const StampImage = styled.img`
  display: block;
  width: 100%;
  object-fit: contain;
  filter: sepia(0.18) saturate(0.82) contrast(0.9);
`;

const PostcardBack = styled.div`
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
`;

const BackColumns = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
`;

const Correspondence = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-left: clamp(18px, 3vw, 34px);
  padding-right: clamp(10px, 1.8vw, 20px);
`;

const AddressColumn = styled.div`
  position: relative;
  flex: 0 0 30%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding-left: clamp(16px, 2.6vw, 28px);
  padding-bottom: clamp(20px, 3.6vw, 30px);
`;

const DividerImprint = styled.div`
  position: absolute;
  left: 0;
  top: 50%;
  transform: translate(-50%, -50%) rotate(-90deg);
  transform-origin: center;
  white-space: nowrap;
  pointer-events: none;
  color: rgba(46, 58, 107, 0.9);
  font-family: "DIY", "Courier New", monospace;
  font-size: clamp(0.4rem, 0.78vw, 0.52rem);
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const LocationImprint = styled.div`
  position: absolute;
  left: clamp(13px, 2.2vw, 24px);
  top: 50%;
  z-index: 3;
  transform: translate(-50%, -50%) rotate(-90deg);
  transform-origin: center;
  white-space: nowrap;
  pointer-events: none;
  color: rgba(46, 58, 107, 0.9);
  font-family: "DIY", "Courier New", monospace;
  font-size: clamp(0.4rem, 0.78vw, 0.52rem);
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const Postdate = styled.div`
  position: absolute;
  left: clamp(12px, 2vw, 22px);
  right: 0;
  bottom: clamp(6px, 1.4vw, 12px);
  text-align: center;
  color: rgba(46, 58, 107, 0.9);
  font-family: "DIY", "Courier New", monospace;
  font-size: clamp(0.5rem, 1vw, 0.64rem);
  letter-spacing: 0.02em;
`;

const AddressBlock = styled.div`
  margin: auto 0;
  color: #2f2620;
  font-family: "Biro Script", "Segoe Print", cursive;
  opacity: 0.85;
  mix-blend-mode: multiply;
`;

const Recipient = styled.div`
  font-size: clamp(1.3rem, 3.2vw, 1.9rem);
  line-height: 1.18;
`;

const AddressLine = styled.div`
  margin-top: 0.15em;
  font-size: clamp(1.05rem, 2.6vw, 1.5rem);
  line-height: 1.2;
`;

const LetterBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 2px 4px 14px 0;
  color: #3c281f;
  font-family: "Oceanside Typewriter", "Courier New", ui-monospace, monospace;
  font-size: clamp(0.82rem, 1.7vw, 1rem);
  line-height: 1.45;
  opacity: 0.85;
  mix-blend-mode: multiply; /* ink sits in the paper rather than on top */
  scrollbar-width: none;

  &::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  p,
  ul,
  ol,
  blockquote {
    margin: 0 0 0.9em;
  }

  strong {
    color: #2d1d17;
  }

  blockquote {
    padding-left: 16px;
    color: rgba(60, 40, 31, 0.72);
    font-style: italic;
  }

  a {
    color: #7b4229;
    text-decoration-thickness: 1px;
    text-underline-offset: 0.18em;
  }
`;

const MarkdownMediaImage = styled.img`
  display: block;
  width: min(100%, 420px);
  max-height: 360px;
  margin: 1.2rem auto;
  object-fit: contain;
  background: rgba(239, 231, 214, 0.7);
  border-radius: 6px;
  filter: sepia(0.08) saturate(0.9);
  box-shadow:
    0 10px 18px rgba(72, 43, 29, 0.16),
    inset 0 0 0 1px rgba(72, 43, 29, 0.08);
`;

const MarkdownVideo = styled.video`
  display: block;
  width: min(100%, 430px);
  max-height: 260px;
  margin: 1.2rem auto;
  border-radius: 6px;
  background: rgba(60, 40, 31, 0.14);
  box-shadow: 0 10px 18px rgba(72, 43, 29, 0.16);
`;

const MediaLink = styled.a`
  color: #7b4229;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.18em;
`;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
