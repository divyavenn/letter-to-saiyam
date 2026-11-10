# Love Letters

A stack of postcard letters for each person you write to, at their own page: `/saiyam`, `/sidd`, `/ranju`. The bare site shows a blank envelope, so nobody can find anyone else's page from it.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/divyavenn/letter-to-saiyam)

## Deploying

The button sets up everything in `render.yaml`; there's nothing to fill in. Letters and photos are kept on a 1 GB persistent disk attached to the server, which Render snapshots daily.

A disk needs a paid instance: Render's smallest one (shown with its price when you deploy) plus $0.25 a month for the disk. In return the site doesn't sleep when idle. Deploys restart the server, so the site is down for a few seconds during each one.

Once it's up, write letters at `/write` and read them at `/<recipient>`, e.g. `/saiyam`.

Anyone who finds `/write` can send letters, and use "download all letters" to read everyone's, so keep that address to yourself.

## Backing up

Below Send in the composer there's **download all letters**: a zip of every recipient's letters (markdown with their frontmatter), all the photos, and `letters.json`, which lists each letter's recipient, date, to, from, location, stamp, cover and photos. The disk is the only copy of letters sent from the composer, so download one now and then.

## Reading

Each person's page has **download letters** in the corner: a zip of their letters as markdown, their photos, and `letters.pdf`, a printable copy laid out like the postcards.

## Writing

In the composer, choose who a letter is for next to Send. Type a name that doesn't have a page yet and sending makes one. That's separate from the "to" line printed on the postcard.

## Files

Letters live in `src/letters/<recipient>/`, one markdown file per letter, named by date. Photos live in `public/images`. On Render both live on the disk; letters committed to this repo are copied onto it on the next deploy, and nothing already on the disk is ever overwritten. Frontmatter picks the cover photo and, optionally, the stamp:

```md
---
date: 2026-06-29
to: Saiyam
from: Divya
image: window-light.png
stamp: priority-approved.svg
---
```

Stamps live in `src/stamps`. Leave `stamp` out and one is chosen for the letter.

Inside the letter body, images and short videos can be referenced by filename from `public/images`:

```md
![Window light](window-light.png)
[Short clip](rain-on-window.mp4)
```

## Running it locally

```sh
npm install
npm run dev
```

Locally it works the same way as on Render. Letters live in `.data/` (git-ignored), which stands in for the disk: the repo's letters are copied in on startup, and anything you send goes there. Read them at http://localhost:5173/saiyam and write at http://localhost:5173/write.

Delete `.data/` to start over from the repo's letters.

`npm test` runs the unit and server tests; `npm run test:e2e` runs the browser tests.
