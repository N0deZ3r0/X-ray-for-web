<div align="center">

# X-ray for web

**An instrument, not a shield. It blocks nothing and shows evidence instead of a counter.**

[![CI](https://github.com/N0deZ3r0/X-ray-for-web/actions/workflows/ci.yml/badge.svg)](https://github.com/N0deZ3r0/X-ray-for-web/actions/workflows/ci.yml)
![version](https://img.shields.io/badge/version-0.1.0-3b5bdb)
![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4c6ef5)
![checks](https://img.shields.io/badge/checks-182-2f9e44)
![runtime dependencies](https://img.shields.io/badge/runtime_dependencies-0-2f9e44)

**English** · [Русский](README.ru.md)

</div>

Blockers tell you "47 trackers blocked". That number cannot be checked, and everyone who
shows it counts it differently. This extension shows no counters. It shows evidence.

**1. What the site read.** A journal of calls to fingerprinting surfaces — canvas, GPU,
audio, fonts, screen, device — each attributed to a specific script through its stack
trace, with a timestamp from the start of the load.

```
0.42 s   canvas.toDataURL              third-party   https://ads.example/t.js:1:8420
0.42 s   webgl.getParameter  ×3        third-party   argument: UNMASKED_RENDERER_WEBGL
0.51 s   audio.OfflineAudioContext     first-party
```

**2. What went out.** Intercepted beacons, parsed field by field into plain language. Not
base64 soup, but:

```
POST https://www.facebook.com/tr        confirmed by network
  Pixel identifier                 1234567890
  Hash of your email address       e3b0c442…
      SHA-256. It cannot be reversed, but it is the same on every site —
      this is what matches you to your Facebook profile
  NOT IDENTIFIED: dpo, fbc_f       shown as-is
```

**3. What went past the instrument.** Observation comes from two independent sources: the
wrappers inside the page, and the browser's own network layer. A request the network saw
and the wrappers did not is an evasion, and it is named as one.

## What it does not do

- It does not block. Anything. Ever.
- It does not count "trackers blocked".
- It does not show entropy bits or a uniqueness score for your fingerprint. Those do not
  exist without a distribution across all users, and this instrument runs on one machine.
  Instead: "14 fingerprinting surfaces taken out of 67".
- It does not name a field whose purpose has not been established. The unidentified are
  marked `NOT IDENTIFIED` and counted.
- It sends nothing anywhere. See "Verify this yourself".

## Install

Not in the Chrome Web Store — load it unpacked.

1. Download this repository (`Code → Download ZIP`, or `git clone`).
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and point it at the `extension` folder — that folder, not the
   repository root.

Chrome 119 or newer.

> The extension's own interface is in Russian. This README, its Russian twin and the
> foundation documents are the reference; the code comments are in Russian.

## Recording a session

1. Open the site you want to see through.
2. Click the extension icon — the side panel opens.
3. **Записать этот сайт** (Record this site). Chrome asks for permission for this site
   only: the instrument works where you switched it on, nowhere else.
4. The tab reloads. That is required, not a glitch — the wrappers must be in place before
   the page's first script, or the first call goes past them.
5. Browse. The panel updates as you go.
6. **Сохранить отчёт** saves a readable report, **Сохранить JSON** the full data.

The **including third-party frames** checkbox extends observation into embedded frames from
other domains. Without it, only the site itself is visible.

The **export without redaction** checkbox turns off value stripping. By default identifiers
and hashes of your email and phone **do not reach the export** — the report is safe to
show to anyone. Uncheck it only if you know why you are doing that.

## Verify this yourself

An instrument for distrustful people has to be checkable. Every claim above can be checked
in a couple of minutes, without trusting the author.

**"It sends nothing anywhere":**

```bash
grep -rn "fetch(\|XMLHttpRequest\|sendBeacon\|WebSocket\|EventSource" extension --include=*.js
```

The only `fetch` in the whole extension is in `background/parsers/index.js`, and it reads
`chrome-extension://…` — its own bundled declaration files. In `instrument/main.js` those
names appear only as things being **wrapped**: the instrument replaces them, it does not
call them.

**"It executes no remote code":** the format parsers are ordinary JSON files in
`extension/background/parsers/`. They are data, not code, and the engine validates them and
rejects the malformed. See [docs/05-parsers.md](docs/05-parsers.md).

**"It stores nothing on disk":** the journal lives in `chrome.storage.session` and dies
with the browser. Exactly one value is written to disk (`storage.local`) — the state of the
"including third-party frames" checkbox:

```bash
grep -rn "storage.local\|storage.sync" extension --include=*.js
```

**"The numbers in the documents are not invented":** there is a bench with 28 fingerprinting
and beacon scenarios, including a deliberate evasion of the instrument. It was written
**before** the extension and serves as the oracle.

```bash
node bench/server.js
```

Open http://localhost:8080. A full run produces exactly 10 network requests: 7 attributable,
3 evasions, 0 false positives across 34 noise requests. Details in
[bench/README.md](bench/README.md).

**The suites:**

```bash
node tests/run.mjs
```

**182 checks** in five suites, with no dependencies at all — plain `node`. The most
important one is not the parser suite but `tests/facts.test.mjs`: remove an event, and the
fact derived from it must disappear. The instrument has no right to state what it did not
record.

## Limits

The instrument lists what it cannot see and where it can be fooled. In short:

- **Workers are not observed.** A fingerprint taken inside a Web Worker is invisible to it.
  This is the one evasion that actually worked in practice.
- **The page can see the wrappers.** Observation from inside is marked `internal`; only a
  match against the network — which the page cannot forge — raises it to `confirmed`.
- **Other extensions** in your browser replace the same APIs. Their calls are marked "not
  the site", but whether an extension acts on its own or at the page's request is something
  this instrument cannot tell.
- **WebSocket is not checked against the network:** permissions do not cover the `ws`
  scheme. That is not the same as "the request did not go out".
- **Font fingerprinting through `offsetWidth`** is deliberately not covered: a wrapper on a
  property that hot costs more than it is worth.

The full list, with the reasoning for each — [docs/06-limits.md](docs/06-limits.md).

## Foundation documents

This project started with documents, not code. Every architectural decision and every
measured number is written down there, including the places where reality contradicted the
document. They are in Russian.

| File | About |
|---|---|
| [docs/01-product.md](docs/01-product.md) | What this is, for whom, the rules of language, what may never be shown |
| [docs/02-architecture.md](docs/02-architecture.md) | MV3 components, the two observation sources, trust levels |
| [docs/03-data-model.md](docs/03-data-model.md) | The event schema — the factual base of the project |
| [docs/04-surfaces.md](docs/04-surfaces.md) | The registry of observed surfaces and what each costs |
| [docs/05-parsers.md](docs/05-parsers.md) | Format parsers, the rule for an unknown field |
| [docs/06-limits.md](docs/06-limits.md) | Limits: what the instrument cannot see and where it is fooled |
| [docs/07-roadmap.md](docs/07-roadmap.md) | v1 stages with checkable completion criteria |
| [docs/08-test-na-lyudyah.md](docs/08-test-na-lyudyah.md) | The test on people: procedure and the wordings under suspicion |
| [docs/09-hod-raboty.md](docs/09-hod-raboty.md) | Work log: what is closed, what was rewritten and why |
| [bench/README.md](bench/README.md) | The bench — the test oracle, written before the extension |
| [bench/perf/README.md](bench/perf/README.md) | Cost measurements, and what could **not** be measured |
| [extension/README.md](extension/README.md) | The extension: install, contents, what has been verified |

## Layout

```
extension/     the extension itself (this is the folder Chrome loads)
  instrument/  the wrappers, running in the page's world
  collector/   the bridge between the page's world and the extension
  background/  service worker: journal, network tap, reconciliation, parsing, export
    parsers/   format declarations — JSON, not code
  ui/          the side panel
  icons/       icons, generated by tools/icons.mjs
bench/         the bench: deliberate fingerprinting across two origins
docs/          foundation documents
tests/         suites, run by plain node
tools/         the icon generator
```

## Platform

Google Chrome, Manifest V3, minimum version 119.
Chrome only — Firefox and Safari are not planned.

## License

[MIT](LICENSE).
