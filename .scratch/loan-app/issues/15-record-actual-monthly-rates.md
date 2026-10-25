# Monthly rate input rejected 10%

Status: resolved
Blocked by: none

## Symptom and root cause

The owner could not enter a 10% monthly rate. In the live creation modal, entering 10 produced `rangeOverflow: true`, `max: "1.25"`, and the browser validation message "Value must be less than or equal to 1.25." The API separately rejected new-loan rates above 125 basis points. Future rate scheduling for new-source loans repeated both restrictions. Original-rate correction already accepted actual rates, leaving an inconsistent multi-step workaround.

The original legal-rate check had been implemented as a data-recording ceiling. The owner's app records actual private records; the requested rate must remain 1000 bps, with legal information distinct from record validation.

## Experiment ledger

1. Ranked hypotheses: HTML numeric maximum, percent scaling error, or an unavailable/disabled field. The live input accepted keystrokes and retained 10, ruling out a disabled field.
2. No debugger attachment tool was available. Traced creation input through `ModalView.handle` to the loan endpoint, and the equivalent future-rate path.
3. Changed only source from new to historical while retaining 10. The maximum disappeared and validity became true. This disproved a general keyboard or percent-parser failure and isolated the source-dependent ceiling.
4. Added a real HTTP regression for actual rates on both sources and future boundaries. The first sandboxed run could not connect to its temporary loopback server (`EACCES`), so it was rerun with local network permission. Before the fix, creation returned 400 instead of 201.
5. Removed only the rate ceilings and shared one monthly input across creation, correction, and scheduling. Kept nonnegative safe integer bps, source/date/money checks, exact future boundaries, duplicate rejection, audit, and replay. Replaced the hard ceiling with a conditional factual advisory linked to the official PRD article.
6. Full suite: 65 tests passed across 8 files. Build and both TypeScript projects passed. Existing lucide bundler directive warnings remain nonfatal.
7. Isolated browser at localhost:4312: a new-source 10,000-baht loan saved at 10%, with no input maximum or overflow. October 15–November 15 gives 1,000 full-cycle interest and 322.58 after 10 of 31 days; calendar October projection is 548.39 for 17 days. Scheduling 10% on November 15 saved with history. Correcting the initial rate to 7.5% saved with before/after audit and displayed 750 per full cycle and 241.94 for 10 days. Browser console had no warnings/errors.

## Why it slipped through

Earlier tests asserted the ceiling as intended policy and tested actual high rates only for historical loans or original-rate corrections. They did not exercise a new-source record at the owner's actual 10% through both browser and API.

## Validation and scope

The HTTP regression records 0%, 7%, 7.5%, 10%, and 15% on both sources, checks persisted bps/source, schedules 10%, 7.5%, and 0%, and rejects negative/fractional/unsafe bps, non-boundaries, retrospective dates, and duplicate future dates. Existing checks retain zero opening interest for new loans. Browser QA uses synthetic data; it does not submit any live loan edits. Screenshot proof is outside the repository at `actual-rate-10-saved.png` in the task visualization folder.

The built production app was restarted on 4310 and its health checked. A combined SHA-256 comparison of stored ledger and owner records was identical before and after restart. The existing Chrome tab now loads the updated app and requires the owner's normal login after the session restart. The QA tab was closed and its verified process/data directory removed.
