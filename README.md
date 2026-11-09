# Grade Lens for FOM

A Chrome extension for FOM students. It shows your grade trajectory, the range your final grade can still land in, and what you need in each open exam to hit a target.

It runs entirely in your browser. There is no server, no account and no stored data.

## How it gets the data

The FOM Online Campus (`oc-digital.de`) is a Vue app. When you open **Study program & exams → Study progress**, it already calls

```
GET /campus/api/epm/studybook/{studiengangId}
```

That response contains every module with ECTS, semester, grade and status, plus each assessment's weight (for example 75% exam / 25% participation), partial grades and exam dates.

`src/hook.js` runs in the page and copies that response as the app receives it. It never reads tokens or cookies and never sends its own requests to FOM. The panel computes everything in memory and forgets it when you close the tab.

## What it shows

Three views, switchable at any time (your choice is remembered):

- **Dashboard**: full-screen overview. It shows your current average, where your plan lands, the range still possible, a per-module planner, your grade trajectory over time, and progress toward the ECTS you need for thesis admission.
- **Drawer**: the same planner in a side panel, with "next up" first.
- **Inline**: no panel at all. A summary bar sits above FOM's own grid, and every open module card gets a date chip, a grade picker and a "need ≥ x" hint.

The core is a **per-module what-if**. For each open module you pick the grade you expect, and the final grade updates live. Modules you don't set run at your pace (your average, rounded to the nearest official grade). Set a target and Grade Lens tells you what the modules you left unset need for it. Partially graded modules (for example 25% participation already done) only use their open share.

Your view, target and picks are saved in `chrome.storage.local` on your device. Grades themselves are never stored.

## Assumptions (read these)

| Rule | Status |
|---|---|
| Grades are truncated after the first decimal, not rounded | **Observed** in the portal: 0.75×2.7 + 0.25×3.3 = 2.85 is shown as 2.8 |
| Final grade = ECTS-weighted mean of all graded modules, thesis module included with its credits | **Unverified**. Check the Rahmenprüfungsordnung / Fachspezifische Prüfungsordnung |
| Ungraded passes count for ECTS only | Follows from the data (no grade field) |
| Every listed module with credits counts toward the final grade | **Unverified**. A module such as a language course may be excluded by the PO |

"What you need" assumes the same grade across all open assessments. It's a planning number, not a guarantee.

## Install (developer mode)

1. Download and unzip this folder.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick the folder.
3. Open the FOM Online Campus → **Study program & exams → Study progress**.
4. Click **Grade Lens** at the bottom left.

## Development

```
node --test test/model.test.js
```

`src/model.js` is pure and fully tested against `test/fixture.studybook.json`, which uses invented modules and grades in the real response shape. No real student data is in this repository.

```
manifest.json      MV3, content scripts on oc-digital.de only, storage permission for view + picks
src/hook.js        MAIN world, document_start: passive copy of the studybook response
src/model.js       parsing, averages, final range, target maths (pure)
src/panel.js       three views (dashboard / drawer / inline), Shadow DOM, SVG charts, no dependencies
test/              node:test unit tests + synthetic fixture
```

## Not affiliated with FOM

This is an independent student project. It depends on an internal API that FOM can change at any time; if that happens, the panel shows an error instead of wrong numbers.
