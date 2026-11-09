#!/usr/bin/env bash
#
# Tests for the shell logic inside generate-graphics.yml.
#
# Two steps in that workflow carry the decisions that keep a bad run from
# damaging the profile: which PAT secret to use, and whether a rendered card is
# real. Both were written against ad-hoc stubs and then thrown away, so nothing
# stopped them regressing. Each has already failed once in a way that published
# wrong data:
#
#   - the card guard accepted a 771-byte "Something went wrong!" error card,
#     because it checked only for HTTP 200 and the string "<svg", and copied it
#     over the real card;
#   - the token check fell back to github.token, which answers 200 but cannot
#     see private work, and rebuilt a 107-day streak as 1.
#
# The run blocks are read out of the YAML rather than copied here, so these
# tests always exercise what the workflow actually runs.
#
#   bash .github/scripts/workflow-logic.test.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/generate-graphics.yml"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0 fail=0
ok()   { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  FAIL %s\n     expected: %s\n     actual:   %s\n' "$1" "$2" "$3"; }
is()   { [ "$2" = "$3" ] && ok "$1" || bad "$1" "$3" "$2"; }
has()  { case "$2" in *"$3"*) ok "$1";; *) bad "$1" "output containing '$3'" "$2";; esac; }
hasnt(){ case "$2" in *"$3"*) bad "$1" "output without '$3'" "$2";; *) ok "$1";; esac; }

# Pull a step's `run:` block out of the workflow by step name.
extract() {
  python3 - "$WORKFLOW" "$1" "$2" <<'PY'
import sys, yaml
wf, name, out = sys.argv[1], sys.argv[2], sys.argv[3]
steps = yaml.safe_load(open(wf))["jobs"]["generate"]["steps"]
for s in steps:
    if s.get("name") == name:
        open(out, "w").write(s["run"]); sys.exit(0)
sys.exit(f"step not found: {name}")
PY
}

echo "token resolution"
extract "Check the API token" "$TMP/token.sh"
mkdir -p "$TMP/bin"
# Stub: only the literal token GOOD is accepted, everything else is 401.
cat > "$TMP/bin/curl" <<'EOF'
#!/bin/bash
for a in "$@"; do [ "$a" = "Authorization: Bearer GOOD" ] && { echo -n 200; exit 0; }; done
echo -n 401
EOF
chmod +x "$TMP/bin/curl"

# Runs the step in a clean env and echoes health.txt. The exit code and the
# exported PAT go to files, not variables: this is called inside a command
# substitution, so anything it assigns dies with the subshell.
run_token() {
  local d="$TMP/run"; rm -rf "$d"; mkdir -p "$d"
  ( cd "$d" && env -i PATH="$TMP/bin:/usr/bin:/bin" GITHUB_ENV="$d/env" \
      HOME="$d" "$@" bash -c 'set -eo pipefail; source '"$TMP"'/token.sh' >/dev/null 2>&1 )
  echo "$?" > "$TMP/exit"
  sed -n 's/^PAT=//p' "$d/env" 2>/dev/null > "$TMP/pat" || : > "$TMP/pat"
  cat "$d/dist/health.txt" 2>/dev/null
}
exitcode() { cat "$TMP/exit"; }
patval()   { cat "$TMP/pat" 2>/dev/null || true; }

out="$(run_token)"
is   "exits clean when no secret is set"        "$(exitcode)" 0
has  "reports FAILING when no secret is set"    "$out" "TOKEN: FAILING"
is   "exports no PAT when none works"           "$(patval)" ""
has  "names each candidate it tried"            "$out" "STATS_TOKENS: not set"
has  "names GH_PAT too"                         "$out" "GH_PAT: not set"

out="$(run_token STATS_TOKENS=GOOD)"
has  "accepts a working STATS_TOKENS"           "$out" "TOKEN: ok via STATS_TOKENS"
is   "exports the working token"                "$(patval)" "GOOD"

# The real failure this guards: a token recreated under the singular name.
out="$(run_token STATS_TOKENS=DEAD STATS_TOKEN=GOOD)"
has  "falls through a dead plural secret"       "$out" "STATS_TOKENS: set but not usable (http 401)"
has  "picks up the singular name"               "$out" "TOKEN: ok via STATS_TOKEN "
is   "exports the one that works"               "$(patval)" "GOOD"

out="$(run_token STATS_TOKENS=DEAD TROPHY_TOKEN=DEAD)"
has  "reports FAILING when every secret is dead" "$out" "TOKEN: FAILING"
is   "exports nothing when every secret is dead" "$(patval)" ""

echo "card guard"
# Run the real render step against a stubbed HTTP layer rather than re-deriving
# its logic here: an earlier version of this test spliced the guard out of the
# YAML with sed and broke on the brace structure, which proves the point.
extract "Render the stats cards" "$TMP/render.raw"
# GitHub expression syntax is not valid bash, so fill it in.
sed 's/\${{ github.repository_owner }}/testuser/g' "$TMP/render.raw" > "$TMP/render.sh"

cat > "$TMP/bin/curl" <<'EOF'
#!/bin/bash
# Serves $FIXTURE with status $CODE to whatever path follows -o.
out=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
[ -n "$out" ] && cp "$FIXTURE" "$out"
echo -n "${CODE:-200}"
EOF
chmod +x "$TMP/bin/curl"

printf '<svg><g data-testid="main-card-body"><text>Total Commits:</text></g></svg>\n' > "$TMP/good.svg"
printf '<svg><text>Something went wrong!</text><text data-testid="message">rate limited</text></svg>\n' > "$TMP/err.svg"
printf 'not xml at all\n' > "$TMP/junk.svg"

# Returns the check line for stats-card.svg; writes the card to $TMP/out/dist.
render_with() {  # fixture, http code
  local d="$TMP/out"; rm -rf "$d"; mkdir -p "$d/dist"
  printf '# no live api urls here\n' > "$d/README.md"
  ( cd "$d" && env -i PATH="$TMP/bin:/usr/bin:/bin" HOME="$d" \
      FIXTURE="$1" CODE="$2" HOST="http://stub" \
      COMMON="hide_border=true" \
      bash -c 'set -eo pipefail; source '"$TMP"'/render.sh' >/dev/null 2>&1 )
  grep -m1 'stats-card.svg' "$d/dist/cards-check.txt" 2>/dev/null
}
published() { [ -s "$TMP/out/dist/stats-card.svg" ] && echo yes || echo no; }

out="$(render_with "$TMP/good.svg" 200)"
has  "accepts a real card at 200"        "$out" "OK"
is   "publishes the real card"           "$(published)" "yes"

out="$(render_with "$TMP/err.svg" 200)"
has  "rejects the error card at 200"     "$out" "FAIL"
has  "says why the error card failed"    "$out" "error-card"
is   "leaves the error card unpublished" "$(published)" "no"

out="$(render_with "$TMP/good.svg" 503)"
has  "rejects a real card on a 503"      "$out" "http=503"
is   "publishes nothing on a 503"        "$(published)" "no"

out="$(render_with "$TMP/junk.svg" 200)"
has  "rejects a non-card body"           "$out" "no-card-body"
is   "publishes nothing for junk"        "$(published)" "no"

echo "workflow invariants"
inv="$(python3 - "$WORKFLOW" <<'PY'
import sys, yaml
steps = yaml.safe_load(open(sys.argv[1]))["jobs"]["generate"]["steps"]
by = {s.get("name"): s for s in steps}
# Every generator must be non-blocking: one failing generator has taken the
# whole job down twice, skipping the backfill and the deploy.
for n in ("Generate pacman graphs", "Generate trophy.svg",
          "Generate streak + activity cards", "Render the stats cards",
          "Check the API token"):
    if by.get(n, {}).get("continue-on-error") is not True:
        print(f"blocking-generator:{n}")
# Anything reading the contribution calendar must require a real PAT, never
# github.token, which cannot see private work.
for n in ("Generate pacman graphs", "Generate trophy.svg",
          "Generate streak + activity cards"):
    if by.get(n, {}).get("if") != "env.PAT != ''":
        print(f"ungated:{n}")
# The deploy wipes the branch, so the backfill must run before it.
names = [s.get("name") for s in steps]
if names.index("Backfill any artifact this run did not produce") > \
   names.index("Push graphics to output branch"):
    print("backfill-after-deploy")
PY
)"
is "every generator is non-blocking and PAT-gated, backfill precedes deploy" "$inv" ""

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
