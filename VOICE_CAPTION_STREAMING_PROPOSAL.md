# Proposal: show voice captions in the history while the person is speaking

**Status (2026-10-03):** Live partial captions now render above the prompt from Composer's existing caption ledger. A generated-speech Desktop check showed the text grow while speech was still in progress. Completed lines still use `ui.log` and appear as dim Mod lines in Claude's history. The separate native-looking timeline row remains unresolved. The discussion below is the older proposal, not the current implementation.
**Asked for by the user:** spoken words, both theirs and the assistant's, should appear in the Claude Code message history as they're spoken, not only after each utterance ends.

## Tested timeline-row experiment

The Mod reference exposes a message `requestId` on `ui.render`; earlier wording below that says there is no row id is incorrect. A hidden slash command produced a `CommandOutput` history row, and `ui.render` could draw its body. Desktop also showed an extra user command row, which a `UserMessage` render hook could make visually empty but not remove from the underlying transcript. Crucially, calling that command from this same Mod during a live spoken turn did not reach the Mod's `command.run` hook: Claude displayed a command error instead of a caption. That experiment was removed from the installed Mod. It did not change Composer.

Do not revive the command approach without a documented way to create the row from the Mod and preserve correct user/attendant semantics. `session.append` system notices were invisible in the earlier Desktop check; user rows are model-visible, so they cannot safely stand in for attendant speech.

## Current behaviour

The text only appears once the utterance is finished.

- `refreshCaptions` (`hooks/register.js`) gets the caption ledger whenever `media.captionRevision` changes. `tick` calls it every 250 ms.
- `VoiceHistory.observe` (`hooks/voice-history.js`) keeps one row per caption id. Each time the text changes it resets `readyAt`:
  - **user:** `now + 2200`, so the row is held until there's 2.2 s without new text, or until a new caption row starts.
  - **assistant:** `Infinity` until `finish('assistant')` is called, then `now + 1200`.
- `flushHistory` posts each row **once**, as a single `$.ui.log(\`You: …\` | \`Voice: …\`, { to: 'transcript' })`, and records `{ id, line }` in `$.store` (`voice-history:<sessionId>`) so a reload doesn't post it again.

## Why the existing line can't just be updated

`$.ui.log` and `$.session.append` can only add lines. A line can't be edited after it's posted. No render site draws `ui.log` lines. `UserMessage` and `AssistantMessage` can redraw transcript rows, but their props don't include a row id, and user-role rows go to the model. That's why this proposal posts smaller pieces sooner and leaves posted lines alone.

## Proposal: post each caption in pieces

The caption keeps one id, but it's posted as several `ui.log` lines as it grows.

1. **Track progress per row:** each row records how many characters it has posted (`postedLength`), not just a `delivered` flag.
2. **Release a piece** from the unposted text when any of these happens:
   - a sentence or clause ends (`.?!` or `,;:`, followed by more text), so the text up to there is stable;
   - about 800–1000 ms passes with nothing new (a pause in speech);
   - the unposted text passes roughly 80–120 characters, cut at the last word boundary.
   When `finish(role)` is called, or a new caption row starts, post whatever is left.
3. **Assistant replies use the same rules.** The `Infinity` hold goes away, so the reply shows up as it's spoken, not only after `finish('assistant')`.
4. **Line format:** the first piece is `You: …` / `Voice: …`. Later pieces are an indented `… more text`, or repeat the prefix. Either works; it's a design choice.
5. **Keep the order:** only the first row that still has text to post may emit pieces, as `ready()` does now, so user and assistant lines don't mix.
6. **Reload dedupe:** store `postedLength` for each id in `$.store` (for example `{ id, line, postedLength }`). Change the `known.has(caption.id)` check in `refreshCaptions` to "skip what was already posted" instead of "mark the whole row delivered". Otherwise a reload in the middle of an utterance loses the rest of it.

The suggested shape is to replace `ready()` with something like `nextPiece(now) → { row, text, isFirst, isFinal } | null`. `flushHistory` would then loop over the pieces, log each one and save `postedLength`.

## Risks to check before committing

- **Captions may be revised.** `host/transcript-ledger.js` replaces `row.text` wholesale on each update. If the provider rewrites earlier words (normal for speech recognition), text that's already posted can't be taken back. Only posting up to a stable boundary limits this. Check how often Composer captions change their start, as opposed to only growing. If the new text no longer starts with what was posted, either post from the longest common prefix or accept small mismatches.
- **Delegated requests may show twice.** At the moment a caption that becomes a coding request is hidden (`line = ''`), because the request is submitted as a prompt. With pieces, part of the caption may already be posted before `markDelegated` runs or `caption.delegated` arrives. Then the history shows both the caption and the submitted prompt. Options are: accept it; hold user pieces until the delegation decision; or hide only what's left once a caption is marked delegated.
- **Volume:** many more dim lines in the history. The release thresholds above control that.
- **Lag:** at best about 250 ms (tick) plus the host's caption update rate. That's close to live, but it's pieces, not word by word.

## Scope

- Files: `hooks/voice-history.js` (most of the change), plus `flushHistory`, `refreshCaptions` and `loadHistory` in `hooks/register.js`.
- The host and the model-facing behaviour don't change. Lines still go through `$.ui.log`, which the model never sees.
- Tests to update or extend:
  - `tests/voice-history.test.mjs`: "growing voice captions become one history row per utterance" would now expect several pieces per utterance.
  - `tests/mod-history.test.mjs`
  - `tests/mod-ledger-history.test.mjs`: distinct turns, omitting delegated prompts.
  - `tests/mod-recovery.test.mjs`: reload in the middle of an utterance.
- Release: bump `.claude-plugin/plugin.json` (0.1.34 → 0.1.35), run `npm run plugin:stage`, then update the installed `voicemesh-controls@voicemesh-local` plugin.

## The other option, not recommended

Post one row early and keep redrawing it from a `UserMessage` / `AssistantMessage` render hook as the caption grows. That gives word-by-word streaming, but:
- the hook has no row id, so the row would have to be found by matching its text;
- user-role rows reach the model;
- the saved copy keeps the first fragment unless it's saved again.

It's only worth trying as an experiment.

---

# Related issue: why spoken text shows up in two different places

**What the user saw:** some of their speech appears as a normal user message bubble, and some appears only as dim `voicemesh-controls You: …` / `Voice: …` lines. To them this looks inconsistent. The user wants this understood, and probably fixed, **before** the streaming work above.

## There are two separate conversations

| | Claude session (coding agent) | Voice model (VoiceMesh host) |
| --- | --- | --- |
| Has | the repo, tools, its reasoning, tool calls and their output | the person's speech, its own replies, the routing decisions |
| Gets from the other | only the delegated requests, submitted as prompts by `$.prompt.submit` (`pollVoiceTask`, `hooks/register.js`) | the final answer of each delegated turn (`turn.complete` → `/api/claude/result`), plus short progress notes: up to 1,000 characters of visible text before a tool call (`turn.step` → `/api/claude/milestone`) |
| Never sees | the conversational `You:` / `Voice:` lines (posted with `$.ui.log`, which the model never reads) | Claude's reasoning, tool calls and their output, the files, anything the user typed or attached in the Claude session |

## How each utterance is routed

1. All speech goes to the realtime voice model first.
2. For each utterance, the voice model decides whether it's a coding request, following the rules in `host/voice-policy.js`: delegate anything that needs the workspace, such as writing, editing, reviewing, running commands or explaining project code; answer ordinary conversation, thanks and confirmations itself.
3. **Delegated:** `dispatch_coding_task` → the host task queue → the mod claims it and calls `$.prompt.submit`, which produces a **normal message bubble** that Claude answers. The mod hides that utterance's dim caption (`line = ''` for `delegated` rows) so it doesn't show twice.
   - With OpenAI Live (`host/voice-server.js`), the request text is the latest spoken line exactly as said (`latestLiveUserRequest`).
   - With the other providers (`host/realtime-voice.js`), it's the `instruction` the voice model writes itself.
4. **Not delegated:** the voice model answers directly. Both sides appear only as dim `ui.log` lines, and **Claude never receives them**.

**Example from the user's session:** "Yeah, drop it in the project, please" was delegated, because it asked for a file write, and appeared as a bubble. "Okay, that's great. Thank you" and a long question about this inconsistency were not delegated. The voice model answered them itself, including "I can't see your screen". It had no access to the Claude session or the screenshot the user had just pasted there.

Routing is the model's judgement, one utterance at a time, so borderline phrasing (questions about the project, meta-discussion) can go either way. That's the inconsistency the user sees.

## Options

1. **Send everything to Claude.** Every finished utterance becomes a prompt; the voice model only transcribes and reads Claude's replies aloud.
   - **Flow:** utterance → prompt in the Claude session → Claude decides: answer briefly, do the work with tools, or ask a clarifying question → the reply goes back to the voice model to speak. The return path already exists for delegated turns (`turn.complete` → `/api/claude/result`).
   - **Pros:**
     - One conversation. Claude hears everything, so the voice side never answers without context ("I can't see your screen" while a screenshot is in the session).
     - Routing is decided with the repo, the history and attachments to hand, not from one utterance on its own.
   - **Cons:**
     - **Latency.** Every utterance is a full model turn, so even "thanks" takes a second or more before anything is spoken.
     - **Cost and context.** Small talk adds turns and uses context.
     - **Speech during a running turn.** `$.prompt.submit` only starts a turn once the session is idle, so a spoken correction or "stop" can't simply be submitted as a prompt. Use Composer's steering path; see "Interrupting and correcting running work" below.
     - **Replies written for the screen.** Claude's replies have links, tables and code. Either the voice model condenses them, or the session is told it's in voice mode and keeps replies speakable, for example with an output style or a short injected instruction.
   - **Recommended variant: thin voice front end.** The voice model keeps a small, fixed job and makes no decisions about content:
     - an instant acknowledgment ("got it", "one sec") so there's no dead air while Claude works;
     - mic and session control (mute, stop voice, end conversation);
     - reading Claude's replies aloud.
     Everything substantive goes to Claude. This means the routing rules in `host/voice-policy.js` stop being a judgement about "is this a coding request?" and become "forward everything except control commands".
2. **Keep the split, but share the context.** Also pass the conversational captions into the Claude session as context the model can read, for example a user-role `$.session.append({ message: { type: 'user', content: [...] } })`, batched per exchange, instead of only showing them with `ui.log`. Claude would then know what was discussed even when the voice model answered.
   - Con: it uses context, and the appended rows are model-visible user content, so they should be framed clearly as "voice conversation transcript, for context".
   - Optionally, also send the voice model a short summary of recent Claude-session activity, beyond final answers, so its own answers are better informed.
3. **Keep the split, but make it obvious.**
   - Label each utterance with the route it took. For example, a mark on the dim line, or a toast or band note saying "sent to Claude" or "answered by voice".
   - Add an explicit spoken trigger that forces delegation, such as "tell Claude…" or "ask the coding agent…". This needs a rule in `voice-policy.js`. Before adding a check on the host side, see whether Composer already offers something suitable; see the guiding rule below.
   - Consider tightening the policy so questions *about* the project or the voice setup are delegated too.

These can be combined. For example, option 3's trigger and labels together with option 2's shared context.

---

# Interrupting and correcting running work

**Guiding rule from the user:** use as much of what VoiceMesh Composer already provides as possible. That matches `README.md` and `IMPLEMENTATION_PLAN.md`: Composer owns speech, turn-taking, interruption and delegation, and this project is a thin adapter for Claude. Before building a mechanism, check Composer and the DeepSeek reference integration (`/Users/hgp/DeepSeek/deepseek-harness-latest/packages/{client/voice-client,host/voice-host}`).

## What Composer already does

- **Barge-in:** talking over the voice assistant cuts off or pauses its speech, and discards scheduled audio.
- **Steer judgement** (`steer-judge`): a model decides whether an interruption redirects the agent ("no, do the other one" → `STEER`) or is an aside ("sorry, that wasn't for you" → `ASIDE`). The default on doubt is not to redirect.
- **The `steer()` hook on `LiveTasks`** (`live-delegation.d.ts`):
  - It sits next to `dispatch()`, as `steer(id, { instruction }, signal)`.
  - The interface says: "Application owns admission, steering, and work lifetime independently of voice". So Composer passes corrections in through `steer()`, and the adapter has to apply them to the coding agent.
  - Composer's revision fields (`revision` / `resultRevision`) let a correction or cancellation invalidate a stale result, so old success text isn't spoken.

## What this project does today

- `host/server.js:66`: `async steer() { throw new Error('Claude steering is unavailable') }`. Every correction or stop that Composer passes in is thrown away.
- `dispatch()` refuses new work while a task is active (`'Claude is busy'`, `host/server.js:61`).
- The result is that a spoken "stop that" or "no, do X instead" can't affect a running Claude turn. Composer's docs also note that stopping voice leaves application work running.

## Reference implementation: DeepSeek `voice-host/src/sts-tasks.ts:273`

`steer(callId, { instruction }, signal)`:
1. It records `coding-task.steer-requested`, deduplicated by a request id derived from the call id.
2. **If the parent task is queued,** it edits the queued message so the instruction is appended (`steer-applied`).
3. **If the parent task is running,** it injects the instruction into the running turn (`agent.steer(createUserMessage(...))`) without restarting it (`steer-applied`). If the turn closed in between, it falls through to step 4.
4. **If there's no active task, or the injection failed,** it queues the instruction as a new prompt (`steer-promoted`) and records `result-owed`, so the outcome is spoken like a fresh dispatch.

DeepSeek's client also hides steering rows in its chat, the same way it hides delegated request rows (`voice-client/README.md`, "suppresses their pending, user, and steering rows").

## Proposed Claude version

1. **Fill in `steer()` in `host/server.js`,** following `sts-tasks.ts`. Record the steer against the active `claudeTask` and give the mod an endpoint to poll, as `/api/claude/request` works today, for example a `steer` record with `{ id, parentId, instruction }`.
2. **Mod side** (`hooks/register.js`), when a steer arrives for the running voice-owned turn:
   - **Task still queued, not yet claimed:** replace or append the task text before it's submitted.
   - **Task running:** Claude has no confirmed equivalent of DeepSeek's `agent.steer` (see the gap below). The fallback is `$.turn.abort({ turnId })` (the mod already records `turnId` at `turn.start`), then `$.prompt.submit` with the correction. Frame it explicitly, for example "The user interrupted the previous request. Correction: …", because the abort leaves no interruption marker.
   - **No task:** submit as a new prompt, and owe the result to voice.
3. **A plain "stop" or "cancel"** with no new instruction: abort, then report the stop back to the host (`/api/claude/result` with `status: 'aborted'`), so Composer's revisions drop any stale result.
4. **Hide steering rows** from the dim caption log, the same way delegated captions are hidden today.

## Gaps to verify before building

- **Injecting into a running Claude turn:** the parts of the mod API checked so far only offer `$.turn.abort` (cancel) and `$.prompt.submit` (which starts once the session is idle). Search `claude-code.d.ts` for any way to queue or inject a message mid-turn (a queue or inbox API, or a `prompt.submit` mode). If one exists, use it for the running case instead of abort and resubmit, to match DeepSeek.
- **Whether `$.turn.abort` behaves well in practice:** how quickly it stops, what happens to a tool that's halfway through, and that it works on a turn the mod submitted. This is documented but untested.
- **When Composer calls `steer()`:** which providers or modes (Live versus the realtime providers in `host/realtime-voice.js`), and whether the voice model has to call a tool. `host/sts-task-tools.js` currently exposes only `dispatch_coding_task`, `get_coding_task_status` and `get_last_output`. Compare with how DeepSeek exposes steering to the voice model.
- **The `'Claude is busy'` refusal in `dispatch()`:** decide whether a new request during a running task should become a steer instead, as DeepSeek promotes it.

---

# Live-bubble experiment results (2026-10-03)

**Context:** voice mod 0.1.51 posts captions in pieces, as dim `ui.log` lines, while the person speaks. The user confirmed they appear live while Claude is idle. While a Claude turn is running, the Desktop app holds `ui.log` lines and shows them when the turn ends. The question was whether one normal bubble per utterance could fill in live instead. Claude ran a throwaway test mod (`live-bubble-test`, in the session's dev-mods folder, since deleted), and Codex and the user watched the screen. The installed voice mod was not changed.

| Test | What it did | Result |
| --- | --- | --- |
| A | `$.session.append({ message: { type: 'user', ... } })`, then a `UserMessage` render hook redrawing rows that contain a marker | **No visible bubble**, during or after. The row did reach the model: Claude received the text in its context. Appended user rows are visible to the model but not drawn. |
| B | `$.prompt.submit({ text, asUser: true })` (deferred with `$.clock.after`, see note), then the same render hook growing the text word by word while Claude ran `sleep 12` | **Worked.** One user bubble appeared and grew in place word by word **while Claude's turn was running**, ending with the full text. The model received the **original submitted text**, not the grown text. |
| C | Full Desktop restart, then the chat reopened | The bubble showed the **original saved prompt**, not the grown caption. The redraw is display only; the saved row never changes. |

**Notes from building it:**
- `$.prompt.submit` called from inside a `command.run` hook did nothing: no bubble, no turn, no error, because the result wasn't checked. Running it after the command finished, with `$.clock.after(300, ...)`, worked.
- `$.clock.every` returns a `Timer` object with `.cancel()`. (A function-returning `every` in the types belongs to the client-surface API, not `$.clock`.)

## What this means for "one live bubble per utterance"

- A visible bubble can only come from `$.prompt.submit`, and that **starts a Claude turn immediately** with whatever text exists at that moment. A live bubble for every utterance would therefore make every utterance a Claude turn, started on its first fragment. That fits the "send everything to Claude" option, not captions of conversation with the voice model.
- Render-hook redraws **do** update live, including while Claude is working. That's better than `ui.log` lines, which are held during a turn.
- After a reload or restart the bubble shows the saved text. To keep the grown text on screen, the mod would have to keep redrawing from its own saved captions (`$.store`), matched to rows by text, because render props carry no row id. The model would still have read only the submitted text.

**Possible shape if "send everything to Claude" is chosen:**
1. Submit a short placeholder once the utterance has started, or submit the final text only once the utterance ends.
2. Draw the live caption over that bubble with the render hook.
3. Use Composer's steer path to give Claude the completed text if the turn started on a fragment.

Each of these needs its own design. The simplest safe version: keep live dim lines (0.1.51) for conversation, and submit one bubble with the final text when an utterance is delegated, which is today's behaviour.
