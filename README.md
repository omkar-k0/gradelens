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

- **Current average**: ECTS-weighted mean of graded modules, raw and truncated.
- **Final range**: your best case (1,0 in everything still open) and worst case (4,0 in everything open), plus where you land if you keep your current average. It also shows how much of your final grade is already locked in.
- **Trajectory**: each module grade over time, with the running ECTS-weighted average.
- **Target setter**: pick a target final grade and see the average you need across all open assessments, the official grade step that achieves it, and how much of the remaining swing each open module controls. Partially graded modules count only their open share.

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
manifest.json      MV3, content scripts on oc-digital.de only, no permissions
src/hook.js        MAIN world, document_start: passive copy of the studybook response
src/model.js       parsing, averages, final range, target maths (pure)
src/panel.js       Shadow-DOM panel, SVG charts, no dependencies
test/              node:test unit tests + synthetic fixture
```

## Not affiliated with FOM

This is an independent student project. It depends on an internal API that FOM can change at any time; if that happens, the panel shows an error instead of wrong numbers.
