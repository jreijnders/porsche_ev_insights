# Issue tracker

Issues for this repo live in **GitHub Issues** on the fork: `jreijnders/porsche_ev_insights`.

Issues were disabled by default on this fork and were enabled on 2026-08-22.

## CLI

`gh` is installed but **not on PATH**. Use the full path:

```
/opt/homebrew/bin/gh
```

Note that the shell is `zsh`, which does **not** word-split unquoted variables — `set -- $pair` inside a loop will not work as it does in bash.

## Remotes

- `origin` → `jreijnders/porsche_ev_insights` (the fork; where issues live)
- `upstream` → `jpleite/porsche_ev_insights` (do not file issues here)

## PRs as a request surface

Off. External PRs are not part of the triage queue.

## Wayfinding operations

Wayfinder maps and tickets use native GitHub relationships.

**Map** — an issue labelled `wayfinder:map`.

```sh
GH=/opt/homebrew/bin/gh; R=jreijnders/porsche_ev_insights
$GH issue list -R $R --label "wayfinder:map" --state open
```

**Tickets** — child issues of the map, each labelled with one of
`wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, `wayfinder:task`.

**Child issues** use the sub-issues API. It needs the child's **database id**, not its
number, and the id must be sent as a typed integer (`-F`, not `-f` — `-f` sends a string
and the API rejects it with a 422):

```sh
CHILD_ID=$($GH api repos/$R/issues/<child-number> --jq .id)
$GH api --method POST repos/$R/issues/<map-number>/sub_issues -F sub_issue_id=$CHILD_ID
```

**Blocking** uses native issue dependencies — same typed-integer rule:

```sh
BLOCKER_ID=$($GH api repos/$R/issues/<blocker-number> --jq .id)
$GH api --method POST repos/$R/issues/<blocked-number>/dependencies/blocked_by -F issue_id=$BLOCKER_ID
```

**Frontier** — open, unblocked, unassigned children of the map:

```sh
for n in $($GH issue list -R $R --state open --json number --jq '.[].number'); do
  blocked=$($GH api repos/$R/issues/$n/dependencies/blocked_by \
    --jq '[.[]|select(.state=="open")]|length' 2>/dev/null)
  assignee=$($GH issue view $n -R $R --json assignees --jq '.assignees|length')
  [ "$blocked" = "0" ] && [ "$assignee" = "0" ] && $GH issue view $n -R $R --json number,title --jq '"#\(.number) \(.title)"'
done
```

**Claiming** — assign to the dev driving the map, before any work:

```sh
$GH issue edit <n> -R $R --add-assignee jreijnders
```

**Resolving** — post the answer as a comment, close the issue, then append a one-line
pointer to the map's `## Decisions so far`.
