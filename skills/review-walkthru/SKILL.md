---
name: review-walkthru
description: Turns a pull request into a guided, step-by-step review in Chrome on the locally running app, collects the reviewer's comments in one prompt, runs fix rounds, and pushes the fixes once the reviewer approves. Use when the user runs /review-walkthru or asks to walk through, test or review a PR in the browser.
argument-hint: "[PR URL or number] [--restart]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" *)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/relay.mjs" *)
  - Bash(gh pr view *)
  - Bash(gh pr diff *)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" *)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/relay.mjs" *)
  - PowerShell(gh pr view *)
  - PowerShell(gh pr diff *)
---

# review-walkthru

You turn a pull request into a guided review of the app running on the reviewer's machine. A page next to the app shows one step at a time: what the screen is, the decisions and doubts behind it, what to test. The reviewer comments, then sends the whole review back to you in one go. You answer and fix **here, in the conversation**; the page only waits for the next scenario.

Arguments: `$ARGUMENTS`. They may name the PR (URL, `owner/repo#123` or number). Without one, take the last PR created in this conversation (the URL `gh pr create` printed) and tell the reviewer which one you picked. If this conversation created none, ask the reviewer which PR to review. `--restart` starts the review over from the PR head.

Scripts live in `${CLAUDE_PLUGIN_ROOT}/scripts`. Run them exactly as written below, quotes included: the quotes keep a path with spaces in one piece, and the permission rules expect that exact form. Quote the paths you fill in too (`"<runDir>"`): Windows user folders often contain a space. The commands work the same in Bash and PowerShell. Your data lives in `${CLAUDE_PLUGIN_DATA}`; scripts do not see that variable, so always pass it with `--data`.

## Language

Talk to the reviewer in their language, in every message of the review, including short progress notes. Write the scenario in that language too. In French, use "tu", like the review page.

## Never

- Push to the PR before the reviewer says yes in this conversation.
- Write anything on GitHub: no PR comment, no change to the PR description. The scenario stays in the work folder.
- Put a password, a token or real personal data in a scenario. Test credentials go in `credentials.json`, never in the scenario.
- Migrate, empty or fill the reviewer's database without their go-ahead.
- Talk to the reviewer through the page. Every answer happens here.

## 1. Check the machine

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" check
```

`extension` says whether Chrome holds the Review Walkthru extension, in which profile, and its `problem` if any. The review needs it: the page refuses to run without it.

- `ok` is false only because of the extension (`problem` is `"absent"`, `"disabled"` or `"outdated"`): tell the reviewer which. For `"absent"`, open its Chrome Web Store page in Chrome:

  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" extension
  ```

  For `"disabled"` or `"outdated"`, point them to `chrome://extensions` (enable it, or turn on Developer mode and click Update). Ask them to say when it is done, then run `check` again. Chrome writes its files a little after an install: if they confirm and `check` still does not see it, carry on; the review page blocks if the extension is really missing. If they do not want the extension, stop: the review does not work without it.
- `problem` is `"unreadable"`: Chrome's files changed shape. Carry on; the page checks for itself.
- Anything else missing: list it and stop.

Do this before reading the PR, so the reviewer installs the extension while you prepare the app.

## 2. Read the PR

```
gh pr view <PR> --json number,title,body,url,headRefName,headRefOid,baseRefName,commits,files,comments,reviews
gh pr diff <PR>
```

`<PR>` is the PR from the arguments as given, or the URL of the PR this conversation created. Take `owner`, `repo` and `number` from `url` (`https://github.com/<owner>/<repo>/pull/<number>`). If `gh` fails, report its error and stop.

You write the scenario from the PR each time, so it always matches its last commit. The decisions the author made live in the PR description, its commits and comments, and in this conversation when it built the PR.

## 3. Open the work folder

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" init --data "${CLAUDE_PLUGIN_DATA}" --repo <owner>/<repo> --number <n> [--restart]
```

It returns `runDir`, `projectFile`, `worktree`, `pageUrl`, `round` and `resumed`.

- `resumed: true` (an earlier review of this PR was stopped): say so, and continue round `round` instead of starting over.
  - If `<runDir>/review-<round>.json` exists, that review is waiting for you: start the relay again in the background (step 6, without `open`), read the review and go to step 7.
  - Otherwise round `round` is still under review: skip step 4, check the app still answers (step 5, reusing what the project file says), start the relay (step 6). Ask the reviewer to reload their review tab if it is still open; run `open` only if they closed it, so two tabs do not share the same round.
- If `init` fails with "started by an older version", the folder dates from before version 0.3.0: run it again with `--restart`.
- `--restart`: if `<worktree>` exists and holds commits that are not on the remote branch, list them and ask before you throw them away. Once the reviewer agrees, reset it to the PR head: `gh pr checkout <n> --force` inside `<worktree>`.

## 4. Write the scenario

Write a `review-walkthru/scenario@2` document to `<runDir>/draft.json`, then register it:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" round "<runDir>" "<runDir>/draft.json"
```

It refuses an invalid scenario and says why: fix the draft and run it again until it passes. To fix a round you already registered, before its review arrives, run the same command with `--replace`. Never edit the work folder's files by hand.

Shape (all fields required unless marked optional):

```json
{
  "format": "review-walkthru/scenario@2",
  "pr": { "repo": "owner/name", "number": 12, "headSha": "<headRefOid>" },
  "round": 1,
  "title": "…", "summary": "What changes, in three to five lines.",
  "app": { "baseUrl": "http://localhost:8000" },
  "prerequisites": [ { "id": "admin", "kind": "account", "text": "Admin test account (credentials shown in the page)" } ],
  "steps": [ {
    "id": "account-unlink", "title": "Unlink Google from the account page", "path": "/admin/users", "requires": ["admin"],
    "start": "/admin/users/01a18e53-…", "startLabel": "Jane Doe's account page",
    "page": "What this screen is and what changed on it.",
    "points": [
      {
        "id": "connection-card", "title": "The Connection card",
        "do": "Google and Microsoft show their address and an Unlink button.",
        "decisions": [ { "id": "d1", "text": "Small red outlined button, no icon.", "cost": "One template line.", "source": "author" } ],
        "doubts": []
      },
      {
        "id": "recent-login", "title": "A recent sign-in is required",
        "do": null,
        "decisions": [ { "id": "d1", "text": "Unlinking needs a session opened by password, Google or Microsoft.", "cost": "…", "source": "author" } ],
        "doubts": []
      }
    ],
    "prefill": [
      { "selector": "input[name=reason]", "value": "Account merged" },
      { "selector": "input[name=_username]", "credential": "admin", "field": "login" }
    ],
    "next": { "stepId": "account-last-method", "instruction": "Stay on the account page", "detect": { "urlMatches": "^/admin/users/[^/]+$" } },
    "reason": null
  } ],
  "skipped": []
}
```

Rules:

- Follow the journey through the app, the way a person uses it, not the list of changed files. Every visible behavior the PR changes appears in at least one step.
- Split each step into **points**, in the order the reviewer does them. A point is one thing to do or look at (`do`), with the decisions and doubts it shows. The reviewer checks each point or comments on it, in one pass: never leave a decision in one place and the thing that shows it in another.
- A decision that cannot be seen on screen becomes its own point with `"do": null` (shown as "To judge"). It needs at least one decision or doubt.
- Each decision gets a `cost`: what it takes to change it if the reviewer disagrees. Use `source: "author"` only for what the PR (description, commits, comments, a previous scenario) or this conversation states; everything you deduce from the diff is `"inferred"`.
- A change with no screen (migration, command, scheduled job) gets a step with `path: null` and points that say how to verify it.
- `round` is the work folder's round plus one. `headSha` is the PR head you review.
- Keep step and point ids stable across rounds; change one only when it changes meaning.
- Write in the reviewer's language (see Language).
- `"prefill"` (optional): the form of the step, filled when the reviewer clicks "Prefill the form". Pick values that hold together across the round: the client one step creates is the one the next step searches for. A test account goes through `{ "selector", "credential": "<prerequisite id>", "field": "login" | "password" }`, never its password. Use selectors that last: `name`, `id`, `data-testid`.
- `"detect"` in `next` (optional): `urlMatches`, a regular expression on the path and query of the app's URL. When the app reaches it, the page moves on to `next.stepId` by itself. Add it when the next screen has a URL of its own (`"^/clients/new$"`, `"^/clients/\\d+$"`).
- `path` is the screen of the step; `start` is where the reviewer lands on it when that differs, such as a given record (`"path": "/admin/users"`, `"start": "/admin/users/01a18e53-…"`). A `start` path needs a `startLabel`: the name a user gives that page ("Jane Martin's profile"), never the URL. The page turns them into one button and drops the link to `path`.

## 5. Prepare the app

The skill does not decide how a project runs. Before opening Chrome you need to know:

- how to start the app, and the address it answers on;
- which database it uses, and whether you may migrate it;
- which data must exist so the screens of the scenario are not empty;
- which accounts and roles the scenario needs, and how to create them.

Look, in this order: `projectFile` (from earlier reviews); what you already know (this conversation, `CLAUDE.md`, your memory); the project's docs and files (`README`, `.claude/launch.json`, `package.json` or `composer.json` scripts, `Makefile`, `Procfile`, `docker-compose`…). Ask the reviewer everything that is still missing, **in one message**. Anything you deduced rather than read in the project file or heard from the reviewer is a proposal: wait for their go-ahead before you migrate, empty or fill a database.

Then:

1. Pick where the PR's code lives:
   - the session's folder, if it is already on the PR head;
   - otherwise `<worktree>`, if it exists already (a resumed review);
   - otherwise create it: `git worktree add --detach "<worktree>"`, then `gh pr checkout <n>` inside it. If git refuses because the PR branch is checked out in another worktree (often the session that built the PR), tell the reviewer where, and ask whether to run the review in that worktree instead.
2. Untracked files (`.env`, local config) do not exist in a fresh worktree. Say so and ask what to do.
3. Start the app as agreed, with long-running servers in the background.
4. Create the test accounts and write them to `<runDir>/credentials.json`: `[{ "prerequisiteId": "admin", "login": "…", "password": "…", "note": "optional" }]`.
5. Check that `app.baseUrl` answers.
6. Write what worked to `projectFile`:
   `{ "format": "review-walkthru/project@1", "launch": "…", "baseUrl": "…", "database": "…", "data": "…", "accounts": "…", "betweenRounds": "…", "updatedAt": "…" }` (free text in each field).

If what the project file says no longer works, say so and ask again. Do not retry in a loop.

## 6. Start the review

Start the relay **in the background** (`run_in_background: true`), then open Chrome:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/relay.mjs" "<runDir>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" open "<runDir>"
```

If `open` fails, read the relay's output. On `ERROR port … unavailable`: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" port "<runDir>"`, start the relay again, then `open` again (the reviewer gets a new tab).

`open` shows the review page in a **new Chrome window**, in the profile that holds the extension; the window may open behind this app: say so. The extension opens the app on its own to the left of the page, in split view (Chrome 155 or later).

Tell the reviewer how to comment on the app itself: ⌥⇧C on macOS, Alt+Shift+C elsewhere, with the app half focused (or the extension's icon, or a right-click on an element or a selected text). Click an element to pin it, drag to frame an area, or select a text. Each comment carries a capture of what they pointed at. If the app runs on another host than `localhost`, `*.localhost` or `127.0.0.1`, the page asks them to allow the extension there once.

Tell the reviewer what is waiting for them (number of steps, accounts in the page, how to send), then end your turn. The relay exits when the review arrives, and that wakes you up.

## 7. When the relay exits

Read the last line of its output.

### `REVIEW <file>`

1. Start the relay again in the background right away, so the page keeps a server while you work. It serves the sent round, and the page stays on "Review sent".
2. Read the review (`review-walkthru/review@2`): each step has a `status` (`validated`, `commented`, `not_reached`), the status of each of its `points` (`validated`, `commented`, `not_seen`), its `comments`, and what the app's console and network reported during the step (`logs`, `requests`). A point the reviewer neither checked nor commented is `not_seen`: it comes back next round. A comment's `anchor` says what it targets:
   - `point` (`id`, maybe a `quote` the reviewer selected) or `step`: the scenario itself;
   - `element`, `text`, `zone`: something on the app, at `url`. `element` gives `selector`, `tag`, `role` and `text` (search the code by the text first, the selector second); `text` adds the selected `quote`; `zone` is an area (`rect`). `capture` is a picture of it, relative to `<runDir>` (`captures/r1-k3.png`): read it with Read before you answer, it shows what the reviewer saw. `null` means no capture. `context` gives the console errors so far in the step and the last request.
3. In the conversation, go through every comment: what you fix, what you answer (a question), what you decline and why, what you defer. Then every step with `logs` (errors and warnings) or `requests` (failed requests), even without a comment: say what failed and what you do about it. Discuss with the reviewer.
4. Fix, then commit in the worktree. **Do not push.**
5. Offer to run the review again. If the reviewer agrees, write the next round:
   - keep `commented` and `not_reached` steps;
   - keep a `validated` step if your changes touch its code;
   - add steps for new visible behavior;
   - put every other step in `skipped`, each with its `reason` ("validated in round 1, the fixes do not touch the list");
   - give every kept step a `reason`;
   - inside a kept step, set `"alreadyValidated": true` on each point the reviewer validated that your changes do not touch: it arrives checked, with "validated in round N", and the reviewer only goes through the others;
   - set each step's `start`: if the data the previous round created still exists and your changes do not touch the step that created it, start there (`"/clients/42"` with its `startLabel`, and say so in `reason`). Otherwise ask the reviewer, or read `betweenRounds` in the project file, whether to start over from the first step or to create the data.
6. Register it with `run.mjs round`. The running relay serves it and the page loads it on its own: do not open Chrome again.

### `FINISH <file>`

The reviewer checked every point of the round and left no comment.

1. Summarize what you will push (the commits) and what was deferred during the review. If the round reported `logs` errors or failed `requests`, list them first, say which ones come from the PR's code, and offer one more round if any does. Ask whether to push.
2. On yes:
   - `git fetch`. If the remote branch moved, rebase your commits; on a conflict, stop and ask.
   - If the new remote commits change visible behavior, do not push yet: offer one more round limited to those steps. The relay is not running after `FINISH`: register the round, then start the relay in the background (step 6, without `open`); the page loads the round on its own.
   - Otherwise `git push` (the permission prompt is expected).
3. Give the list of pushed commits.

The reviewer can stop at any time without pushing. Your fixes stay in the worktree.
