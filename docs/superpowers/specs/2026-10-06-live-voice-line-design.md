# Live voice line: design

Date: 2026-10-06
Status: draft, awaiting Hopeton's review

## Problem

Voice captions are posted into Claude's message history while they are still being spoken. Providers
deliver text very differently: GPT Live grows a line word by word and inserts "Mm-hmm" sounds; xAI sends
each stretch of speech seconds apart and calls lines complete too early. Every attempt to post the
history early has broken on some provider: dropped words (before 0.1.74), split bubbles (0.1.74–0.1.75),
and one word per bubble on GPT Live (0.1.76).

On xAI, OpenAI Realtime and Gemini, the prompt sent to Claude is the voice model's own rewrite (for
example "User reports that…"). It shows in the transcript as if the user had said it. GPT Live already
sends the user's own words.

## Decision

Live text goes in one place, the voice strip, and the history gets only finished turns.

### 1. Live line (voice strip, left side)

- One line in the voice strip above the prompt. It starts at the left edge and stops a little short of
  the existing controls on the right (wave, timer, mute, speaker, settings).
- It shows whoever is talking, labelled **You** or **Voice**. While the user talks it shows the user's
  words. It switches to the voice only when the voice takes its turn. Short listening sounds the voice
  makes while the user is still talking ("Mm", "Mm-hmm") do not switch it.
- The newest words are always visible. Once the line is full, older words drop off the left behind "…".
- It redraws on every update, so choppy provider updates only change what the line shows.
- It clears when the turn ends.
- The text comes from what the Mod already receives for every provider: the media state's `transcript`
  (user) and `lastReply` (voice), served by the host at `/api/state`.

### 2. Finished turns

- **Conversation:** each finished turn is written to the message history once, as one complete bubble
  per speaker (`/voice-said`, as today). A bubble is never written early or in pieces.
- **Work for Claude:** the voice still decides each turn whether it is conversation or work. On a
  hand-off, the prompt is the user's exact words on every provider. For xAI, OpenAI Realtime and Gemini,
  the host replaces the `dispatch_coding_task` instruction with the user's latest spoken line, as GPT Live
  already does through `latestLiveUserRequest`. It falls back to the model's instruction only when there
  is no user transcript. That turn gets no separate speech bubble, because the prompt already shows the
  words.

### 3. Turn boundaries

A user turn ends when the voice takes its turn, or when voice goes idle. A voice turn ends when its reply
finishes. The history code keeps only this rule and drops its early-posting logic: clause and pause
pieces, follow-on bubbles, and the settle and hold timers added on 2026-10-06.

## Components

| Unit | Change |
| --- | --- |
| `hooks/register.js` (AbovePrompt render) | Draw the live line on the left of the strip from `media.transcript` / `media.lastReply` and `media.phase` |
| `hooks/voice-history.js` | Simplify to "one bubble per finished turn" |
| `host/sts-task-tools.js` or `host/realtime-voice.js` | Use the user's latest spoken line as the hand-off prompt for xAI, OpenAI Realtime and Gemini |

## Testing

- Unit tests for the live line: who it shows, how it truncates from the left, and that it ignores the
  voice's listening sounds while the user talks.
- History tests that replay recorded provider patterns: GPT Live word-by-word growth with "Mm-hmm"
  inserted, xAI segments arriving seconds apart and marked complete early, and OpenAI completed events.
  Each must give exactly one bubble per turn with the full text.
- A hand-off test showing that the xAI, OpenAI Realtime and Gemini path sends the user's words, not the
  model's instruction.
- A live check in Desktop on GPT Live and xAI.

## Out of scope

- The voice-speaking indicator (deferred).
- Spacing between history bubbles (deferred).
- Host-enforced guards for image questions and false "it's done" claims (separate task).
