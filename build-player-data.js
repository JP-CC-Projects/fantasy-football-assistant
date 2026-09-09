#!/usr/bin/env node
/**
 * Rebuild player-data.js from local projection, ADP, and injury snapshots.
 *
 * Usage: node build-player-data.js
 *        node build-player-data.js --refresh
 *        node build-player-data.js --refresh-injuries
 *
 * Remote refresh URLs live in data/sources.local.json (not committed).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const YEAR = 2026;
const DATA_DIR = path.join(__dirname, "data");
const INJ_DIR = path.join(DATA_DIR, "injuries");
const RISK_PATH = path.join(DATA_DIR, "injury-risk-2026.json");
const SOURCES_PATH = path.join(DATA_DIR, "sources.local.json");
const UA = "Mozilla/5.0 (compatible; fantasy-football-assistant/2026)";

const INJURY_SEASONS = [2023, 2024, 2025];
const SEASON_WEIGHT = { 2023: 1, 2024: 2, 2025: 3 };
const SEASON_WEEKS = 17;
const SKILL_POS = new Set(["QB", "RB", "WR", "TE", "K"]);
const POS_ALIAS = { FB: "RB", HB: "RB", PK: "K" };
const NAME_ALIASES = {
    hollywoodbrown: "marquisebrown",
    drewogletree: "andrewogletree"
};

const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DST"];

const TEAMS = {
    ARI: "Arizona Cardinals",
    ATL: "Atlanta Falcons",
    BAL: "Baltimore Ravens",
    BUF: "Buffalo Bills",
    CAR: "Carolina Panthers",
    CHI: "Chicago Bears",
    CIN: "Cincinnati Bengals",
    CLE: "Cleveland Browns",
    DAL: "Dallas Cowboys",
    DEN: "Denver Broncos",
    DET: "Detroit Lions",
    GB: "Green Bay Packers",
    HOU: "Houston Texans",
    IND: "Indianapolis Colts",
    JAC: "Jacksonville Jaguars",
    JAX: "Jacksonville Jaguars",
    KC: "Kansas City Chiefs",
    LAC: "Los Angeles Chargers",
    LAR: "Los Angeles Rams",
    LV: "Las Vegas Raiders",
    MIA: "Miami Dolphins",
    MIN: "Minnesota Vikings",
    NE: "New England Patriots",
    NO: "New Orleans Saints",
    NYG: "New York Giants",
    NYJ: "New York Jets",
    PHI: "Philadelphia Eagles",
    PIT: "Pittsburgh Steelers",
    SEA: "Seattle Seahawks",
    SF: "San Francisco 49ers",
    TB: "Tampa Bay Buccaneers",
    TEN: "Tennessee Titans",
    WAS: "Washington Commanders",
    FA: "Free Agent"
};

async function fetchJson(url) {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
}

function teamName(abbr, fallbackName) {
    if (!abbr) return fallbackName || "Free Agent";
    return TEAMS[abbr] || fallbackName || abbr;
}

function slugName(name) {
    return String(name)
        .toLowerCase()
        .replace(/\b(jr|sr|iii|ii|iv|v)\b\.?/g, "")
        .replace(/['.]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function normName(name) {
    const aliased = NAME_ALIASES[String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "")] || name;
    return String(aliased)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\b(jr|sr|iii|ii|iv|v)\b\.?/g, "")
        .replace(/['’`.,-]/g, "")
        .replace(/[^a-z0-9]+/g, "");
}

function canonicalPos(pos) {
    const p = String(pos || "").toUpperCase();
    return POS_ALIAS[p] || p;
}

function parseCsv(text) {
    const rows = [];
    let field = "";
    let row = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
            continue;
        }
        if (c === '"') {
            inQuotes = true;
            continue;
        }
        if (c === ",") {
            row.push(field);
            field = "";
            continue;
        }
        if (c === "\n") {
            row.push(field);
            if (row.some(Boolean)) rows.push(row);
            field = "";
            row = [];
            continue;
        }
        if (c === "\r") continue;
        field += c;
    }
    if (field.length || row.length) {
        row.push(field);
        if (row.some(Boolean)) rows.push(row);
    }
    if (!rows.length) return [];
    const header = rows[0].map(h => String(h || "").trim());
    return rows.slice(1).map(r => {
        const obj = {};
        header.forEach((h, idx) => {
            obj[h] = r[idx] == null ? "" : String(r[idx]);
        });
        return obj;
    });
}

async function downloadText(url) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.text();
}

function loadLocalSources() {
    if (!fs.existsSync(SOURCES_PATH)) return null;
    return JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8"));
}

function expandUrl(template, year) {
    return String(template).replace(/\{year\}/g, String(year));
}

async function ensureInjurySources() {
    const refresh = process.argv.includes("--refresh-injuries");
    fs.mkdirSync(INJ_DIR, { recursive: true });
    const sources = loadLocalSources();
    if (!sources || !sources.injuries || !sources.stats) {
        if (refresh) throw new Error("Missing data/sources.local.json injury/stats URLs");
        return;
    }
    const files = [
        ...INJURY_SEASONS.map(y => ({
            path: path.join(INJ_DIR, `injuries_${y}.csv`),
            url: expandUrl(sources.injuries, y)
        })),
        {
            path: path.join(INJ_DIR, `injuries_${YEAR}.csv`),
            url: expandUrl(sources.injuries, YEAR)
        },
        ...INJURY_SEASONS.map(y => ({
            path: path.join(INJ_DIR, `stats_reg_${y}.csv`),
            url: expandUrl(sources.stats, y)
        }))
    ];
    for (const file of files) {
        if (!refresh && fs.existsSync(file.path) && fs.statSync(file.path).size > 100) continue;
        console.log(`Downloading ${path.basename(file.path)}…`);
        fs.writeFileSync(file.path, await downloadText(file.url));
    }
}

function weekSeverity(row) {
    const injuryText = `${row.report_primary_injury || ""} ${row.practice_primary_injury || ""}`.toLowerCase();
    if (injuryText.includes("not injury related") || injuryText.includes("resting player") || injuryText.includes("resting veteran")) {
        return 0;
    }
    const status = String(row.report_status || "").trim();
    if (status === "Out") return 1;
    if (status === "Doubtful") return 0.7;
    if (status === "Questionable") return 0.22;
    const named = Boolean(String(row.report_primary_injury || "").trim() || String(row.practice_primary_injury || "").trim());
    if (!named) return 0;
    const practice = String(row.practice_status || "").trim();
    if (practice === "Did Not Participate In Practice") return 0.4;
    if (practice === "Limited Participation in Practice") return 0.1;
    return 0;
}

function addIdentity(index, gsis, name, pos, team) {
    const canon = canonicalPos(pos);
    if (!gsis || !SKILL_POS.has(canon)) return;
    const rec = index.ids.get(gsis) || { names: new Set(), pos: canon, team: team || null };
    rec.pos = canon;
    if (team) rec.team = team;
    if (name) rec.names.add(name);
    index.ids.set(gsis, rec);
    const key = `${normName(name)}|${canon}`;
    if (name && !index.namePos.get(key)?.includes(gsis)) {
        const list = index.namePos.get(key) || [];
        list.push(gsis);
        index.namePos.set(key, list);
    }
}

function loadInjuryIndex() {
    const index = { ids: new Map(), namePos: new Map() };
    for (const y of INJURY_SEASONS) {
        const injPath = path.join(INJ_DIR, `injuries_${y}.csv`);
        const statsPath = path.join(INJ_DIR, `stats_reg_${y}.csv`);
        if (fs.existsSync(injPath)) {
            for (const row of parseCsv(fs.readFileSync(injPath, "utf8"))) {
                addIdentity(index, row.gsis_id, row.full_name, row.position, row.team);
            }
        }
        if (fs.existsSync(statsPath)) {
            for (const row of parseCsv(fs.readFileSync(statsPath, "utf8"))) {
                addIdentity(index, row.player_id, row.player_display_name, row.position, row.recent_team);
            }
        }
    }
    const inj2026 = path.join(INJ_DIR, "injuries_2026.csv");
    if (fs.existsSync(inj2026)) {
        for (const row of parseCsv(fs.readFileSync(inj2026, "utf8"))) {
            addIdentity(index, row.gsis_id, row.full_name, row.position, row.team);
        }
    }
    return index;
}

function computeRawScores() {
    const reports = new Map();
    const games = new Map();
    const outs = new Map();
    const bump2026 = new Map();

    for (const y of INJURY_SEASONS) {
        const injPath = path.join(INJ_DIR, `injuries_${y}.csv`);
        if (!fs.existsSync(injPath)) continue;
        for (const row of parseCsv(fs.readFileSync(injPath, "utf8"))) {
            const kind = row.season_type || row.game_type || "REG";
            if (kind !== "REG") continue;
            const gsis = row.gsis_id;
            const week = Number(row.week);
            if (!gsis || !Number.isFinite(week)) continue;
            const bySeason = reports.get(gsis) || new Map();
            const byWeek = bySeason.get(y) || new Map();
            const sev = weekSeverity(row);
            if (sev > (byWeek.get(week) || 0)) byWeek.set(week, sev);
            bySeason.set(y, byWeek);
            reports.set(gsis, bySeason);
            if (String(row.report_status || "").trim() === "Out") {
                const outSeasons = outs.get(gsis) || new Set();
                outSeasons.add(y);
                outs.set(gsis, outSeasons);
            }
        }
        const statsPath = path.join(INJ_DIR, `stats_reg_${y}.csv`);
        if (!fs.existsSync(statsPath)) continue;
        for (const row of parseCsv(fs.readFileSync(statsPath, "utf8"))) {
            const gsis = row.player_id;
            const n = Number(row.games);
            if (!gsis || !Number.isFinite(n)) continue;
            const bySeason = games.get(gsis) || new Map();
            bySeason.set(y, n);
            games.set(gsis, bySeason);
        }
    }

    const inj2026 = path.join(INJ_DIR, "injuries_2026.csv");
    if (fs.existsSync(inj2026)) {
        for (const row of parseCsv(fs.readFileSync(inj2026, "utf8"))) {
            const practice = String(row.practice_status || "").trim();
            let bump = 0;
            if (practice === "Did Not Participate In Practice") bump = 0.08;
            else if (practice === "Limited Participation in Practice") bump = 0.04;
            if (bump) bump2026.set(row.gsis_id, Math.max(bump2026.get(row.gsis_id) || 0, bump));
        }
    }

    const scores = new Map();
    const gsisIds = new Set([...reports.keys(), ...games.keys(), ...bump2026.keys()]);
    for (const gsis of gsisIds) {
        const seasonScores = {};
        let num = 0;
        let den = 0;
        for (const y of INJURY_SEASONS) {
            const weekMap = reports.get(gsis)?.get(y);
            const reportScore = weekMap
                ? Math.min(1, [...weekMap.values()].reduce((s, v) => s + v, 0) / SEASON_WEEKS)
                : 0;
            const played = games.get(gsis)?.get(y);
            const hadOut = outs.get(gsis)?.has(y) || reportScore >= 0.1;
            let miss = null;
            if (Number.isFinite(played)) {
                const rawMiss = Math.max(0, 1 - played / SEASON_WEEKS);
                if (rawMiss < 0.15 || hadOut) miss = rawMiss;
                else {
                    const prev = games.get(gsis)?.get(y - 1);
                    miss = Number.isFinite(prev) && prev >= 12 && played <= 10 ? rawMiss : Math.min(rawMiss, 0.08);
                }
            } else if (hadOut) {
                miss = Math.max(reportScore, 0.5);
            }
            const seasonScore = miss == null ? reportScore : 0.7 * miss + 0.3 * reportScore;
            if (weekMap || Number.isFinite(played)) {
                seasonScores[y] = Math.round(seasonScore * 1000) / 1000;
                num += SEASON_WEIGHT[y] * seasonScore;
                den += SEASON_WEIGHT[y];
            }
        }
        const base = den ? num / den : 0;
        const risk = Math.round(Math.min(1, base + (bump2026.get(gsis) || 0)) * 1000) / 1000;
        scores.set(gsis, { risk, seasons: seasonScores });
    }
    return scores;
}

function teamAbbr(teamName) {
    const hit = Object.entries(TEAMS).find(([, full]) => full === teamName);
    return hit ? hit[0] : null;
}

function resolveGsis(player, index) {
    if (!SKILL_POS.has(player.position)) return null;
    const key = `${normName(player.name)}|${player.position}`;
    const cands = index.namePos.get(key) || [];
    if (cands.length === 1) return cands[0];
    if (cands.length > 1) {
        const abbr = teamAbbr(player.team);
        const teamHit = cands.find(gsis => {
            const t = index.ids.get(gsis)?.team;
            return t === abbr || (abbr === "LAR" && (t === "LA" || t === "LAR")) || (abbr === "JAC" && (t === "JAC" || t === "JAX"));
        });
        return teamHit || cands[0];
    }
    const sameName = [...index.namePos.entries()]
        .filter(([k]) => k.startsWith(`${normName(player.name)}|`))
        .flatMap(([, ids]) => ids);
    const uniq = [...new Set(sameName)];
    return uniq.length === 1 ? uniq[0] : null;
}

async function loadInjuryRisk() {
    const haveLocal = INJURY_SEASONS.every(y =>
        fs.existsSync(path.join(INJ_DIR, `injuries_${y}.csv`)) &&
        fs.existsSync(path.join(INJ_DIR, `stats_reg_${y}.csv`))
    );
    const refresh = process.argv.includes("--refresh-injuries");
    if (refresh || haveLocal) {
        if (refresh || !haveLocal) await ensureInjurySources();
        return { mode: "computed", index: loadInjuryIndex(), scores: computeRawScores() };
    }
    if (fs.existsSync(RISK_PATH)) {
        const cached = JSON.parse(fs.readFileSync(RISK_PATH, "utf8"));
        return { mode: "cached", byId: new Map((cached.players || []).map(p => [p.id, p.risk])) };
    }
    console.warn("No injury snapshots or injury-risk-2026.json; leaving risk at 0");
    return { mode: "none" };
}

function playerId(position, name) {
    return `${position.toLowerCase()}_${slugName(name)}`;
}

function matchKey(name) {
    return slugName(name);
}

function round1(n) {
    return Math.round(Number(n) * 10) / 10;
}

function toFinite(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v : null;
}

function adpRecord(p) {
    return {
        adp: toFinite(p.rank_ave) ?? toFinite(p.rank_ecr),
        bye: toFinite(p.player_bye_week),
        tier: toFinite(p.tier),
        adpStd: toFinite(p.rank_std)
    };
}

async function loadSourceData() {
    const localProj = path.join(DATA_DIR, "projections-2026.json");
    const localAdp = path.join(DATA_DIR, "adp-2026.json");
    const refresh = process.argv.includes("--refresh");

    if (!refresh && fs.existsSync(localProj) && fs.existsSync(localAdp)) {
        console.log("Using local snapshots (no network)");
        return {
            projections: JSON.parse(fs.readFileSync(localProj, "utf8")),
            adp: JSON.parse(fs.readFileSync(localAdp, "utf8"))
        };
    }

    const sources = loadLocalSources();
    if (!sources || !sources.projections || !sources.adp) {
        throw new Error("Missing data/sources.local.json projection/ADP URLs");
    }
    console.log("Fetching projections…");
    const projections = await fetchJson(expandUrl(sources.projections, YEAR));
    console.log("Fetching ADP…");
    const adp = sanitizeAdp(await fetchJson(expandUrl(sources.adp, YEAR)));
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(localProj, JSON.stringify(projections, null, 2));
    fs.writeFileSync(localAdp, JSON.stringify(adp, null, 2));
    return { projections, adp };
}

function sanitizeAdp(adp) {
    const drop = new Set([
        "player_page_url",
        "player_square_image_url",
        "player_image_url"
    ]);
    const players = (adp.players || []).map(p => {
        const next = { ...p };
        for (const key of drop) delete next[key];
        return next;
    });
    return { ...adp, players };
}

async function main() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const { projections, adp } = await loadSourceData();
    const injury = await loadInjuryRisk();

    const adpByFpid = new Map();
    const adpByNamePos = new Map();
    for (const p of adp.players || []) {
        const rec = adpRecord(p);
        adpByFpid.set(String(p.player_id), rec);
        adpByNamePos.set(`${matchKey(p.player_name)}|${p.player_position_id}`, rec);
    }

    const oldPath = path.join(__dirname, "player-data.js");
    const usedIds = new Set();
    const players = [];

    for (const p of projections.players || []) {
        const position = p.position_id;
        if (!POS_ORDER.includes(position)) continue;

        const stats = p.stats || {};
        const evRaw = stats.points_ppr ?? stats.points;
        const ev = Number.isFinite(Number(evRaw)) ? round1(evRaw) : null;

        let id = playerId(position, p.name);
        if (usedIds.has(id)) {
            id = `${id}_${(p.team_id || "fa").toLowerCase()}`;
        }
        usedIds.add(id);

        const rec =
            adpByFpid.get(String(p.fpid)) ||
            adpByNamePos.get(`${matchKey(p.name)}|${position}`) ||
            {};

        const team = position === "DST" ? p.name : teamName(p.team_id, p.name);

        players.push({
            id,
            name: p.name,
            team,
            position,
            EV: ev,
            risk: 0,
            ADP: rec.adp ?? null,
            bye: rec.bye ?? null,
            tier: rec.tier ?? null,
            adpStd: rec.adpStd ?? null
        });
    }

    const riskRows = [];
    if (injury.mode === "computed") {
        for (const player of players) {
            const gsis = resolveGsis(player, injury.index);
            const scored = gsis ? injury.scores.get(gsis) : null;
            player.risk = scored ? scored.risk : 0;
            if (scored || gsis) {
                riskRows.push({
                    id: player.id,
                    name: player.name,
                    position: player.position,
                    gsis: gsis || null,
                    risk: player.risk,
                    seasons: scored?.seasons || {}
                });
            }
        }
        fs.writeFileSync(RISK_PATH, JSON.stringify({
            seasons: INJURY_SEASONS,
            weights: SEASON_WEIGHT,
            method: "0-1 frailty = recency-weighted blend of games missed (regulars with Out/IR history) and weekly injury-report severity. Rest listings ignored. Current-season practice DNP/Limited adds a small status bump.",
            generated: new Date().toISOString().slice(0, 10),
            players: riskRows
        }, null, 2));
        console.log(`Wrote ${path.relative(__dirname, RISK_PATH)} (${riskRows.filter(r => r.risk > 0).length} players with risk > 0)`);
    } else if (injury.mode === "cached") {
        for (const player of players) {
            player.risk = injury.byId.get(player.id) || 0;
        }
        console.log("Applied cached injury-risk-2026.json");
    }

    players.sort((a, b) => {
        const pos = POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position);
        if (pos !== 0) return pos;
        const ae = a.EV == null ? -Infinity : a.EV;
        const be = b.EV == null ? -Infinity : b.EV;
        return be - ae;
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const counts = Object.fromEntries(POS_ORDER.map(pos => [pos, players.filter(p => p.position === pos).length]));
    const withAdp = players.filter(p => p.ADP != null).length;
    const withBye = players.filter(p => p.bye != null).length;
    const withTier = players.filter(p => p.tier != null).length;
    const withStd = players.filter(p => p.adpStd != null).length;
    const withRisk = players.filter(p => p.risk > 0).length;

    const header = [
        `window.PlayerDataVersion = "ppr-${YEAR}-${stamp}-v3";`,
        `// ${YEAR} PPR draft projections + consensus ADP + injury risk`,
        `// Generated ${stamp} | ${players.length} players | ADP ${withAdp} bye ${withBye} tier ${withTier} adpStd ${withStd} risk ${withRisk}`
    ].join("\n");

    const body = JSON.stringify(players, null, 4);
    fs.writeFileSync(oldPath, `${header}\nwindow.PlayerData = ${body};\n`);

    console.log("Wrote player-data.js");
    console.log("Counts", counts);
    console.log(`Total ${players.length}, ADP ${withAdp}, bye ${withBye}, tier ${withTier}, adpStd ${withStd}, risk ${withRisk}`);
    console.log("Top EV", players.slice(0, 8).map(p => `${p.position} ${p.name} ${p.EV} ADP ${p.ADP} bye ${p.bye} t${p.tier}`));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
