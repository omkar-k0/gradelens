# Chrome Web Store listing

> Not submitted. Grade Lens is shared through GitHub for now (decided 21 Nov 2026). Kept here in case of a store release later.

Everything to paste into the developer dashboard for v1.0.0. Upload file: `dist/gradelens-1.0.0.zip` (`npm run build`).

## Store listing

**Name** (from `_locales`): Grade Lens for FOM · German: Grade Lens für die FOM

**Summary** (max 132 characters, from `_locales`):
- EN: Your FOM grade trajectory, final-grade range and what you need in each open exam. Runs entirely in your browser.
- DE: Dein FOM-Notenverlauf, die mögliche Endnote und was du in jeder offenen Prüfung brauchst. Läuft komplett im Browser.

**Category:** Education

**Language:** English (default), German

**Description (EN):**

Grade Lens is a free, independent tool for students at FOM University of Applied Sciences.

Open Study progress in the FOM Online Campus and Grade Lens shows you:
- your current average and how it got there, module by module
- the range your final grade can still land in, and how much of it is already fixed
- what you need in each open exam to reach the final grade you aim for
- your next exam dates, with the next 14 days highlighted

Pick the grade you expect in each open module and the final grade updates as you go. Choose from three views: a side panel, small notes on FOM's own module cards, or a full dashboard. English and German.

Private by design: Grade Lens only reads the study book the portal already loads for you. It sends nothing anywhere, has no server, no account and no tracking. Your view, target and picks are saved on your own device only.

Independent student project, not affiliated with or endorsed by FOM. The final-grade formula is an assumption (ECTS-weighted mean of module grades, truncated after the first decimal); check it against your Prüfungsordnung.

Source code (MIT): https://github.com/omkar-k0/gradelens

**Description (DE):**

Grade Lens ist ein kostenloses, unabhängiges Tool für Studierende der FOM Hochschule.

Öffne den Studienverlauf im FOM Online Campus und Grade Lens zeigt dir:
- deinen aktuellen Schnitt und wie er sich Modul für Modul entwickelt hat
- in welchem Bereich deine Endnote noch landen kann und wie viel davon schon feststeht
- was du in jeder offenen Prüfung für deine Wunsch-Endnote brauchst
- deine nächsten Prüfungstermine, die nächsten 14 Tage hervorgehoben

Wähle für jedes offene Modul die Note, die du erwartest, und die Endnote passt sich sofort an. Drei Ansichten: Seitenleiste, kurze Hinweise auf den Modulkarten der FOM oder ein volles Dashboard. Auf Deutsch und Englisch.

Datensparsam: Grade Lens liest nur das Studienbuch, das das Portal ohnehin für dich lädt. Es sendet nichts, hat keinen Server, kein Konto und kein Tracking. Ansicht, Ziel und deine Auswahl werden nur auf deinem Gerät gespeichert.

Unabhängiges Studierendenprojekt, nicht mit der FOM verbunden oder von ihr unterstützt. Die Formel für die Endnote ist eine Annahme (ECTS-gewichteter Mittelwert der Modulnoten, nach der ersten Nachkommastelle abgeschnitten); prüfe sie mit deiner Prüfungsordnung.

Quellcode (MIT): https://github.com/omkar-k0/gradelens

**Screenshots** (1280×800, synthetic data only): `store/screenshots/en-*.png`, and the `de-*` set for the German listing.

**Icon:** `icons/icon128.png`

## Privacy tab

**Single purpose:** Show FOM students their grade trajectory, possible final-grade range and the grades they need in open exams, calculated from the study book the FOM Online Campus already loads.

**Permission justifications:**
- `storage`: saves the chosen view, language, target grade and the student's own grade picks on this device, so they are still there next time. No grades from the portal are stored.
- `activeTab`: lets the toolbar popup show a short summary of the FOM tab the student has open and switch its view.
- Host access `https://oc-digital.de/*` (content scripts): the FOM Online Campus is the only site where Grade Lens runs. It reads the study book response the page already requested; it makes no requests of its own.

**Remote code:** No. All code ships in the package; fonts are bundled.

**Data usage:** Check "Personally identifiable information": no. "Authentication information": no. "Personal communications": no. "Location": no. "Web history": no. "User activity": no. "Website content": the extension processes grades shown on the FOM portal, locally only. Certify: not sold, not used for unrelated purposes, not used for creditworthiness.

If the dashboard asks whether the extension handles "Website content": yes, read locally to compute the averages, never transmitted.

**Privacy policy URL:** https://omkarkhadilkar.dev/gradelens/privacy/

## Before you submit

- [ ] German texts checked by a native speaker (listing, `_locales/de`, `src/i18n.js`)
- [ ] Final-grade formula confirmed (ask your professor or the Prüfungsamt)
- [ ] One-time developer registration fee paid on your Google account
- [ ] Privacy policy page live at the URL above
