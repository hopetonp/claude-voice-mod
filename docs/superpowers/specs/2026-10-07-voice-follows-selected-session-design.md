# Voice follows the selected session: design

Status: approved 2026-10-07; built 2026-10-07 (plan `docs/superpowers/plans/2026-10-07-voice-follows-selected-session.md`); live test pending.

## Goal

The voice plugins load in every Claude Code session in every folder. There is one voice. The session the user has
selected in the desktop app owns it: the user's speech is addressed to that session, and the voice speaks only for
it. Other sessions keep working on what they were asked, and their results wait until the user returns to them.

## Decisions

1. **The selected session owns the voice.** Only one session is selected at a time. In split view, the session the
   user selected last owns it.
2. **Each session has its own voice conversation and its own voice state.** A session remembers whether its voice
   was on when the user left it. Arriving at a session restores that state: voice comes on, loaded with that
   session's own history, only if it was on there; otherwise it is off. Turning voice on or off by hand sets the
   current session's state. The reconnect takes about 2 to 3 seconds. Nothing said in one session is carried into
   another. (Changed during the live test on 2026-10-07: the first build carried the voice into every session.)
3. **One voice job per session, many sessions at once.** A job is one request the voice hands to Claude, which may
   ask for several things. Each session may have one running. A job keeps running when the user switches away,
   as Claude sessions already do. The host's current limit of one request across all sessions is removed.
4. **Background results wait in their own session.** When a job in a session the user is not viewing finishes:
   - a toast shows its full project folder name, for example "chopitup: result ready", and goes away by itself;
   - a short, soft chime plays once, unless the user has turned off Connection sounds;
   - a badge in the selected session's voice row shows the count, `● 1 result ready` or `● 2 results ready`, and
     stays until those results are heard.
   When the user selects that session, its waiting result is spoken at once if voice is on, or when voice next
   starts there.
5. **The plugins are installed for the whole account.** This was done on 2026-10-07 (controls 0.1.104, bubbles
   0.1.14), and the copies installed only for this folder were removed.

## The selection signal

The desktop app attaches to a session when it is selected and detaches from it when the user leaves. This was tested
on 2026-10-07 across sessions in three folders (codex-voice-mod, deepseek-harness, chopitup). Every switch produced
`session.detach` (reason `detach`) in the session left and `session.attach` (surface `desktop`) in the session
opened. While a session is not selected, `$.session.surfaces()` is empty and its voice strip is not drawn at all.

The newly selected session attaches about 0.4 seconds before the old one detaches. Ownership therefore moves on
**attach**: the newest attach wins, and a detach never takes ownership from anyone. A session in another folder
starts only when it is first selected, so its plugin loads, then attaches.

Not yet observed: split view. The rule "newest attach wins" covers it either way; the live test confirms it.

## Components

### Plugin (hooks/register.js)

- On `session.attach` with surface `desktop`, posts `POST /api/claude/select { sessionId, cwd }` to the host.
- At start, it no longer claims the host for its session. It reports itself only on attach, so a session the desktop
  merely starts never takes the voice.
- Its strip draws the live line, orb and history only while its session owns the voice. Since an unselected session
  is not drawn, this is mainly a guard for split view.
- Shows the results badge from the host's state: the count of waiting results in sessions other than its own.
- On a background result, shows the toast with the folder name and asks the voice page to play the chime.

### Host (host/server.js and ledgers)

- **Selected session.** Replaces the single `claudeSessionId` binding with `selectedSession`, set by
  `/api/claude/select`. The old 5-second rule and its 409 refusal are removed.
- **Switching while voice is on.** When `selectedSession` changes and a voice conversation is live, the host closes
  that conversation and has the voice page start a new one for the new session, with that session's history as
  startup history. Voice that is off or in standby stays as it is.
- **Jobs per session.** The task ledger holds one task per session instead of one overall. Requests, claims,
  progress, results and reviews are all keyed by the session the request was spoken in, never by whichever session
  is selected when the job ends.
- **Results per session.** The result ledger already keeps unspoken results per session. On a switch to a session
  with an owed result, that result is read back right away when voice is live, using the existing standby read-back.
- **State for the badge.** `/api/state` gains `waitingResults: [{ sessionId, folder }]` for results owed to sessions
  other than the selected one.

### Voice page (media/main.js)

- Plays the result chime when the host asks.
- Reconnects for a session switch. It reuses the existing start flow, so a switch is a stop followed by a start for
  the new session.

## Data flow: a switch while voice is on

1. The user selects session B. B's plugin receives `session.attach` and posts `/api/claude/select` for B.
2. The host sets `selectedSession = B`, closes A's voice conversation and starts B's with B's history.
3. If B has an owed result, the host reads it back as B's conversation starts.
4. A's job, if any, keeps running. When it finishes, its result is filed under A and listed in `waitingResults`.
   B's plugin shows the toast and the badge, and the chime plays.
5. When the user selects A again, steps 1 to 3 run for A and A's result is spoken. The badge count drops.

## Error handling

- **A reconnect that fails:** the strip shows the usual voice error. The selection still moves, so the next start
  begins in the right session.
- **A job's result for a session that has been closed:** it stays in the ledger and is never spoken. The badge
  counts only sessions whose plugin has checked in recently.

## Testing

- Unit tests for the host: select, ownership on attach, the attach-before-detach ordering, tasks and results keyed
  by session, `waitingResults`.
- Unit tests for the plugin: attach posts select, start does not claim, badge counts, the toast on a new result.
- Live test: start a job in session A, switch to B and start another, hear nothing from A while in B, see the toast,
  the chime and the badge, switch back to A and hear its result. Then repeat in split view.

## Out of scope, later

- **Overseer voice.** A voice started outside any one session, with context across projects and sessions, that can
  direct and coordinate them. This design keeps conversations, jobs and results filed by session so an overseer can
  read across them later.
- **Tap the badge to go to the session.** No plugin API switches the desktop's selected session. Add this when one
  exists.
- **Switching without a reconnect.** Some providers can replace the conversation without closing the connection;
  GPT Live may not. Try it after this works, per provider.
- **Session titles.** The plugin can read a session's folder but not the title shown in the sidebar, so names shown
  are folder names.
