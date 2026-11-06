# Love Letters

A stack of postcard letters for each person you write to, at their own page: `/saiyam`, `/sidd`, `/ranju`. The bare site shows a blank envelope, so nobody can find anyone else's page from it.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/divyavenn/letter-to-saiyam)

## Deploying

The button sets up everything in `render.yaml`. Render asks for one thing, `GITHUB_TOKEN`: a [fine-grained token](https://github.com/settings/personal-access-tokens/new) for this repo with **Contents: read and write**. It stays in Render; you never paste it into a browser.

Once it's up, the deploy logs print the composer's address:

```
Write letters at https://letters-xxxx.onrender.com/write/3f9a…
```

That address is the key: anyone with it can send letters, so keep it to yourself. To change it, set a new `WRITE_SECRET` in Render.

Sending a letter commits it to this repo, and Render redeploys with it. It's on the recipient's page right away.

On Render's free plan the site sleeps when idle, so the first visit after a while takes a few seconds.

## Writing

In the composer, choose who a letter is for next to Send. Type a name that doesn't have a page yet and sending makes one. That's separate from the "to" line printed on the postcard.

## Files

Letters live in `src/letters/<recipient>/`, one markdown file per letter, named by date. Photos live in `public/images`. Frontmatter picks the cover photo and, optionally, the stamp:

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

That starts the site at http://localhost:5173 and the composer at http://localhost:5173/write/. Without a `GITHUB_TOKEN`, letters you send are written straight into `src/letters` and `public/images`.

`npm test` runs the unit and server tests; `npm run test:e2e` runs the browser tests.
