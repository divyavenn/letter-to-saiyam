# Love Letters

Markdown letters live in `src/letters`.

Front postcard images live in `public/images`. In frontmatter, pick one with a filename:

```md
---
date: 2026-06-29
image: window-light.png
---
```

Stamp PNGs live in `src/stamps`. You can specify one stamp, multiple stamps, or omit stamps to let the app choose one deterministically:

```md
stamp: priority-approved.png
stamps: priority-approved.png, another-stamp.png
```

Inside the letter body, images and short videos can be referenced by filename from `public/images`:

```md
![Window light](window-light.png)
[Short clip](rain-on-window.mp4)
```
