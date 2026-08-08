/**
 * Renders the streak card and the activity graph from the GitHub contribution
 * calendar, using the repo owner's own PAT.
 *
 * These two cards used to come from streak-stats.demolab.com and
 * github-readme-activity-graph.vercel.app. Both are shared public instances,
 * and both started returning "failed to retrieve contributions" when their own
 * GitHub tokens hit limits - the same failure that already took out two stats
 * instances. Generating them here removes the dependency entirely: the data
 * comes from the same API and token the trophy and pacman steps already use,
 * and the SVGs ship on the output branch alongside them.
 *
 * Usage: node contrib-cards.mjs <login> <outDir>   (env: GH_TOKEN)
 */

const [, , LOGIN, OUT_DIR = "dist"] = process.argv;
const TOKEN = process.env.GH_TOKEN;

const ACCENT = "#58A6FF";
const BG = "#0d1117";
const DIM = "#8b949e";

/** Runs a GraphQL query against the GitHub API. */
async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "contrib-cards",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.data;
}

/**
 * Fetches every contribution day since the account was created.
 * contributionsCollection caps at one year per call, so this walks year by year.
 */
async function fetchAllDays() {
  const { user } = await gql(
    `query($login:String!){ user(login:$login){ createdAt } }`,
    { login: LOGIN },
  );
  // Snap to midnight UTC. createdAt carries a time of day, and stepping a year
  // from it put every window boundary mid-day, so the boundary date was split
  // across two queries and the merge below kept the larger half instead of the
  // whole day. Aligning to midnight means no date is ever split.
  const created = new Date(user.createdAt);
  created.setUTCHours(0, 0, 0, 0);
  const now = new Date();
  const days = new Map();
  let restricted = 0;
  let allTimeCommits = 0;

  for (let from = new Date(created); from < now; from.setUTCFullYear(from.getUTCFullYear() + 1)) {
    const to = new Date(from);
    to.setUTCFullYear(to.getUTCFullYear() + 1);
    const data = await gql(
      `query($login:String!,$from:DateTime!,$to:DateTime!){
        user(login:$login){
          contributionsCollection(from:$from,to:$to){
            restrictedContributionsCount
            totalCommitContributions
            contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } }
          }
        }
      }`,
      { login: LOGIN, from: from.toISOString(), to: (to > now ? now : to).toISOString() },
    );
    const cc = data.user.contributionsCollection;
    restricted += cc.restrictedContributionsCount;
    allTimeCommits += cc.totalCommitContributions;
    for (const w of cc.contributionCalendar.weeks) {
      for (const d of w.contributionDays) {
        // Windows are day-aligned, so a date appears in at most one window with
        // a real count; other windows report it as 0 inside a padded week.
        days.set(d.date, Math.max(days.get(d.date) || 0, d.contributionCount));
      }
    }
  }
  const list = [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  // Printed so a mismatch against the profile graph is diagnosable rather than
  // guessed at. restrictedContributionsCount is private-repo activity, which is
  // the usual reason a day reads lower here than on github.com.
  console.log(`restrictedContributionsCount (all windows): ${restricted}`);
  console.log(`totalCommitContributions summed over all years: ${allTimeCommits}`);
  console.log(
    "last 7 days: " + list.slice(-7).map((d) => `${d.date}=${d.count}`).join(" "),
  );
  return list;
}

/** Computes total contributions plus current and longest streak. */
function computeStreaks(days) {
  const total = days.reduce((n, d) => n + d.count, 0);

  let longest = { len: 0, start: null, end: null };
  let run = { len: 0, start: null };
  for (const d of days) {
    if (d.count > 0) {
      if (run.len === 0) run.start = d.date;
      run.len++;
      if (run.len > longest.len) longest = { len: run.len, start: run.start, end: d.date };
    } else {
      run = { len: 0, start: null };
    }
  }

  // Today with no contributions yet does not break a streak; a zero before that does.
  let i = days.length - 1;
  if (i >= 0 && days[i].count === 0) i--;
  let cur = { len: 0, start: null, end: i >= 0 ? days[i].date : null };
  while (i >= 0 && days[i].count > 0) {
    cur.len++;
    cur.start = days[i].date;
    i--;
  }

  return { total, longest, current: cur, first: days[0]?.date ?? null };
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmt = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${MONTHS[+m - 1]} ${+d}, ${y}`;
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Renders the three-panel streak card at the same 495x195 as the original. */
function streakCard(s) {
  const W = 495, H = 195, col = W / 3;
  const panel = (cx, big, label, sub, ring) => `
    ${ring
      ? `<circle cx="${cx}" cy="72" r="34" fill="none" stroke="${ACCENT}" stroke-width="5" opacity="0.85"/>`
      : ""}
    <text x="${cx}" y="${ring ? 82 : 78}" text-anchor="middle" fill="${ACCENT}"
          font-size="${ring ? 30 : 34}" font-weight="700"
          font-family="Segoe UI,Ubuntu,sans-serif">${esc(big)}</text>
    <text x="${cx}" y="122" text-anchor="middle" fill="${ACCENT}" font-size="14"
          font-weight="${ring ? 700 : 400}"
          font-family="Segoe UI,Ubuntu,sans-serif">${esc(label)}</text>
    <text x="${cx}" y="145" text-anchor="middle" fill="${DIM}" font-size="12"
          font-family="Segoe UI,Ubuntu,sans-serif">${esc(sub)}</text>`;

  const range = (a, b) => (a && b ? (a === b ? fmt(a) : `${fmt(a)} - ${fmt(b)}`) : "-");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none">
  <rect width="${W}" height="${H}" rx="6" fill="${BG}"/>
  ${panel(col * 0.5, s.total.toLocaleString("en-US"), "Total Contributions", `${fmt(s.first)} - Present`, false)}
  ${panel(col * 1.5, s.current.len, "Current Streak", range(s.current.start, s.current.end), true)}
  ${panel(col * 2.5, s.longest.len, "Longest Streak", range(s.longest.start, s.longest.end), false)}
  <line x1="${col}" y1="40" x2="${col}" y2="155" stroke="${DIM}" stroke-width="1" opacity="0.35"/>
  <line x1="${col * 2}" y1="40" x2="${col * 2}" y2="155" stroke="${DIM}" stroke-width="1" opacity="0.35"/>
</svg>`;
}

/** Renders an area/line chart of the last `n` days of contributions. */
function activityGraph(days, n = 31) {
  const W = 820, H = 320, L = 55, R = 25, T = 55, B = 45;
  const pts = days.slice(-n);
  const iw = W - L - R, ih = H - T - B;
  const max = Math.max(1, ...pts.map((d) => d.count));
  const x = (i) => L + (pts.length === 1 ? iw / 2 : (i * iw) / (pts.length - 1));
  const y = (v) => T + ih - (v / max) * ih;

  const line = pts.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.count).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${T + ih} L${x(0).toFixed(1)},${T + ih} Z`;

  const ticks = 4;
  const grid = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = Math.round((max / ticks) * i), gy = y(v);
    return `<line x1="${L}" y1="${gy.toFixed(1)}" x2="${W - R}" y2="${gy.toFixed(1)}"
                  stroke="${DIM}" stroke-width="1" opacity="0.15"/>
            <text x="${L - 10}" y="${(gy + 4).toFixed(1)}" text-anchor="end" fill="${DIM}"
                  font-size="11" font-family="Segoe UI,Ubuntu,sans-serif">${v}</text>`;
  }).join("");

  const every = Math.ceil(pts.length / 12);
  const xlabels = pts.map((d, i) => {
    if (i % every) return "";
    const [, m, dd] = d.date.split("-");
    return `<text x="${x(i).toFixed(1)}" y="${H - B + 20}" text-anchor="middle" fill="${DIM}"
                  font-size="11" font-family="Segoe UI,Ubuntu,sans-serif">${MONTHS[+m - 1]} ${+dd}</text>`;
  }).join("");

  const dots = pts.map((d, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(d.count).toFixed(1)}" r="2.5" fill="${ACCENT}"/>`).join("");

  const sum = pts.reduce((a, d) => a + d.count, 0);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="6" fill="${BG}"/>
  <text x="${W / 2}" y="30" text-anchor="middle" fill="${ACCENT}" font-size="16" font-weight="700"
        font-family="Segoe UI,Ubuntu,sans-serif">Contribution Activity - last ${pts.length} days (${sum} contributions)</text>
  ${grid}
  <path d="${area}" fill="url(#fade)"/>
  <path d="${line}" fill="none" stroke="${ACCENT}" stroke-width="2.5"
        stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
  ${xlabels}
</svg>`;
}

async function main() {
  if (!LOGIN || !TOKEN) {
    console.error("Usage: node contrib-cards.mjs <login> <outDir>; GH_TOKEN required");
    process.exit(1);
  }
  const { writeFile, mkdir } = await import("node:fs/promises");

  const days = await fetchAllDays();
  if (!days.length) {
    throw new Error("contribution calendar came back empty");
  }

  const stats = computeStreaks(days);
  console.log(
    `days=${days.length} total=${stats.total} current=${stats.current.len} longest=${stats.longest.len}`,
  );

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}/streak.svg`, streakCard(stats));
  await writeFile(`${OUT_DIR}/activity-graph.svg`, activityGraph(days));
  console.log(`wrote ${OUT_DIR}/streak.svg and ${OUT_DIR}/activity-graph.svg`);
}

// Only run when executed directly, so the pure functions stay testable.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

export { computeStreaks, streakCard, activityGraph };
