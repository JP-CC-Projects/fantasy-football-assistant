/* algorithms.v2.js
   Fantasy Draft Algorithms – Refactor per roadmap
   Public API preserved (window.DraftAlgo) with expanded options.

   Inputs: array of players { name, pos, EV, ADP, risk?, bye?, team?, tier?, adpStd? }
   Roster state tracked separately and passed in each call.
*/
(() => {
    "use strict";
  
    // ---- League setup (from your rules; keep overridable externally if needed) ----
    const STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1 };
    const MAX_POS = { QB: 4, RB: 8, WR: 8, TE: 3, DST: 3, K: 3 };
    const FLEX_ELIGIBLE = new Set(["RB", "WR", "TE"]);
  
    // Streaming depth bump (pushes replacement deeper -> lowers VOR early)
    const STREAM_FUDGE = { QB: -2, RB: 0, WR: 0, TE: 1, DST: 6, K: 8 };
  
    // ---- Utilities ----
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
    const isNum = (x) => typeof x === "number" && Number.isFinite(x);
    const toNum = (x, def = 0) => { const n = Number(x); return Number.isFinite(n) ? n : def; };
    const by = (key, dir = "desc") => (a, b) => { const va = a[key], vb = b[key]; if (va === vb) return 0; const cmp = va < vb ? -1 : 1; return dir === "asc" ? cmp : -cmp; };
    const head = (arr, n) => arr.slice(0, Math.max(0, n));
  
    const groupCounts = (arr, key) => arr.reduce((m, x) => { const k = x[key]; m[k] = (m[k] || 0) + 1; return m; }, {});
    const sum = (arr) => arr.reduce((a,b)=>a+b,0);
  
    // ---- Roster state helpers ----
    function makeEmptyRosterState() {
      return {
        have: { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0, K: 0 },
        startersFilled: { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0, K: 0 },
        haveFlex: 0,          // 0 or 1 (you have 1 FLEX starter slot)
        benchTotal: 0,
        benchCap: 7
      };
    }
  
    function canDraftPos(rs, pos) {
      const mx = MAX_POS[pos];
      if (isNum(mx) && rs.have[pos] >= mx) return false;
      // Soft rule: do not take a 3rd QB until RB2, WR2, and FLEX are filled
      if (pos === 'QB' && (rs.have.QB || 0) >= 2) {
        const needRB2 = (rs.startersFilled.RB || 0) < (STARTERS.RB || 0);
        const needWR2 = (rs.startersFilled.WR || 0) < (STARTERS.WR || 0);
        const needFLEX = (rs.haveFlex || 0) < (STARTERS.FLEX || 0);
        if (needRB2 || needWR2 || needFLEX) return false;
      }
      // If only bench remains and bench is full, block:
      const starterOpen = rs.startersFilled[pos] < (STARTERS[pos] || 0);
      const flexOpen = FLEX_ELIGIBLE.has(pos) && rs.haveFlex < STARTERS.FLEX;
      const anyStarterOpen = starterOpen || flexOpen;
      if (!anyStarterOpen && rs.benchTotal >= rs.benchCap) return false;
      return true;
    }
  
    // Mutates rs to reflect adding a player at pos.
    function applyPick(rs, pos) {
      let consumedStarterOrFlex = false;
  
      if (rs.startersFilled[pos] < (STARTERS[pos] || 0)) {
        rs.startersFilled[pos] += 1;
        consumedStarterOrFlex = true;
      } else if (FLEX_ELIGIBLE.has(pos) && rs.haveFlex < STARTERS.FLEX) {
        rs.haveFlex += 1;
        consumedStarterOrFlex = true;
      }
  
      rs.have[pos] += 1;
  
      if (!consumedStarterOrFlex) {
        rs.benchTotal = Math.min(rs.benchCap, rs.benchTotal + 1);
      }
      return rs;
    }
  
    // ---- Draft math ----
    function picksUntilNext(pickInRound, roundNumber, nTeams) {
      return (roundNumber % 2 === 1)
        ? 2 * (nTeams - pickInRound)   // odd round
        : 2 * (pickInRound - 1);       // even round
    }
  
    function overallPick(roundNumber, pickInRound, nTeams) {
      const within = (roundNumber % 2 === 1)
        ? pickInRound
        : (nTeams - pickInRound + 1);
      return (roundNumber - 1) * nTeams + within;
    }
  
    function nextPickContext(roundNumber, pickInRound, nTeams) {
      const gap = picksUntilNext(pickInRound, roundNumber, nTeams) + 1; // +1 to move to your next pick
      const currOverall = overallPick(roundNumber, pickInRound, nTeams);
      const nextOverall = currOverall + gap;
      // derive (round, pickInRound) at nextOverall
      const r = Math.ceil(nextOverall / nTeams);
      const idxInRound = nextOverall - (r - 1) * nTeams;
      const forward = (r % 2 === 1);
      const pir = forward ? idxInRound : (nTeams - idxInRound + 1);
      return { nextOverall, nextRoundNumber: r, nextPickInRound: pir, picksToNext: gap - 1 };
    }
  
    // ---- Replacement levels (advanced) ----
    /**
     * Compute replacement EV baselines.
     * If opts.initialByPos is provided, use dynamic scarcity based on already taken counts.
     * Otherwise, fall back to league-size baseline (original behavior).
     */
    function replacementLevelsAdvanced(players, nTeams, opts = {}) {
      const { initialByPos = null } = opts;
      const byEV = (a, b) => (a.EV === b.EV ? 0 : a.EV < b.EV ? 1 : -1);
  
      const flexPool = head(
        players.filter(p => FLEX_ELIGIBLE.has(p.pos)).sort(byEV),
        nTeams
      );
  
      const flexShare = { RB: 0, WR: 0, TE: 0 };
      if (flexPool.length > 0) {
        const counts = { RB: 0, WR: 0, TE: 0 };
        for (const p of flexPool) counts[p.pos] = (counts[p.pos] || 0) + 1;
        for (const k of Object.keys(flexShare)) flexShare[k] = counts[k] / nTeams;
      }
  
      const countsRemaining = groupCounts(players, 'pos');
      const rep = {};
  
      for (const p of ["QB", "RB", "WR", "TE", "DST", "K"]) {
        const pool = players.filter(x => x.pos === p).sort(byEV);
  
        // base required across league (starters + flex share for flex-eligible)
        let base = nTeams * (STARTERS[p] || 0);
        if (FLEX_ELIGIBLE.has(p)) base += nTeams * (flexShare[p] || 0);
  
        // dynamic adjustment: if we know initial totals, approximate how many at this pos are already taken
        let k;
        if (initialByPos && isNum(initialByPos[p])) {
          const initial = initialByPos[p];
          const remaining = countsRemaining[p] || 0;
          const taken = Math.max(0, initial - remaining);
          const startersTarget = nTeams * (STARTERS[p] || 0);
          const startersRemaining = Math.max(0, startersTarget - Math.min(taken, startersTarget));
          const perTeamRemaining = startersRemaining / nTeams; // fraction of a starter slot per team still empty
          const dynamicBase = perTeamRemaining * nTeams + (FLEX_ELIGIBLE.has(p) ? nTeams * (flexShare[p] || 0) : 0);
          k = Math.max(1, Math.floor(dynamicBase + (STREAM_FUDGE[p] || 0)));
        } else {
          k = Math.max(1, Math.floor(base + (STREAM_FUDGE[p] || 0)));
        }
  
        rep[p] = pool.length >= k ? pool[k - 1].EV : 0;
      }
  
      const flexCand = players.filter(p => FLEX_ELIGIBLE.has(p.pos)).sort(byEV);
      rep["FLEX"] = flexCand.length >= nTeams ? flexCand[nTeams - 1].EV : 0;
      return rep;
    }
  
    // ---- Roster-fit & policy weights ----
    function rosterFitWeight(pos, rs, opts = {}) {
      const { scoring = { ppr: 1.0, tePremium: 1.0 } } = opts;
      const startersOpen = rs.startersFilled[pos] < (STARTERS[pos] || 0);
      const flexOpen = FLEX_ELIGIBLE.has(pos) && rs.haveFlex < STARTERS.FLEX;
      if (startersOpen) return 1.00 * (pos === 'TE' ? scoring.tePremium : 1);
      if (flexOpen) return 0.90 * (pos === 'TE' ? scoring.tePremium : 1);
  
      const depthAtPos = rs.have[pos] - rs.startersFilled[pos];
      const base = Math.max(0.40, 0.65 - 0.05 * depthAtPos);
      return base * (pos === 'TE' ? scoring.tePremium : 1);
    }
  
    function riskPenalty(p, roundNumber, opts) {
      const { riskLambda = 0.0, riskLambdaByRound = null } = opts || {};
      const lambda = typeof riskLambdaByRound === 'function' ? riskLambdaByRound(roundNumber) : (riskLambda || 0.0);
      return lambda * (toNum(p.risk, 0));
    }
  
    // Simple bye clustering penalty only for starters
    function byePenaltyFor(p, rs, roundNumber, opts = {}) {
      const policy = opts.byePolicy || null;
      if (!policy) return 0;
      const { maxSameByeStarters = { RB: 2, WR: 2, TE: 1 }, basePenalty = 0.0, scaleByRound = true, totalRounds = 16 } = policy;
      if (!p.bye || !FLEX_ELIGIBLE.has(p.pos)) return 0;
  
      const startersOpen = rs.startersFilled[p.pos] < (STARTERS[p.pos] || 0) || (FLEX_ELIGIBLE.has(p.pos) && rs.haveFlex < STARTERS.FLEX);
      if (!startersOpen) return 0; // only penalize clustering among likely starters
  
      const threshold = maxSameByeStarters[p.pos] ?? 2;
      const currentSameBye = 0; // requires tracking your current roster by bye; omitted unless rs carries bye counts
      // You can extend rs to hold bye counts; for now we apply a weak constant penalty near mid rounds.
      let penalty = basePenalty;
      if (scaleByRound && totalRounds > 0) {
        const t = 1 - clamp(roundNumber / totalRounds, 0, 1); // higher early, decays late
        penalty *= t;
      }
      // Without explicit bye counts, apply a tiny penalty only (caller can set basePenalty=0 if undesired)
      return penalty;
    }
  
    // ---- Survival models ----
    function survivalProbADP(adpOverall, thresholdPick, sigma = 8.0) {
      if (!isNum(adpOverall)) return 0.5;
      const z = (thresholdPick - adpOverall) / sigma; // +z ⇒ more likely already taken by threshold
      const pGone = 1 / (1 + Math.exp(-z));
      return clamp(1 - pGone, 0, 1);
    }
  
    // Demand-aware survival adjustment (approximate)
    function adjustSurvivalWithDemand(p, survive, posRank, expectedTakenAtPos) {
      // If expected taken at this position exceeds #players above this candidate, reduce survival accordingly.
      const margin = (posRank - 1) - expectedTakenAtPos; // positive => likely survive
      if (margin >= 2) return survive; // comfortable
      if (margin <= -2) return survive * 0.25; // very unlikely to survive
      // interpolate for -2..2
      const factor = clamp(0.25 + 0.1875 * (margin + 2), 0.25, 1.0); // piecewise linear between 0.25 and 1
      return survive * factor;
    }
  
    // ---- Opponent demand model (lightweight) ----
    function estimatePositionDemandBetweenPicks(opponents, youSeatIndex, picksToNext, nTeams, opts = {}, remainingPlayers = []) {
      // opponents: array length nTeams with minimal roster counts; may be null/undefined => use priors
      // returns expectedTaken[pos] across the gap
      const positions = ["QB", "RB", "WR", "TE", "DST", "K"];
      const expected = { QB:0,RB:0,WR:0,TE:0,DST:0,K:0 };
      if (!Array.isArray(opponents) || opponents.length !== nTeams) return expected;
  
      // Precompute positional availability in remaining pool as a soft prior
      const remainingByPos = { QB:0,RB:0,WR:0,TE:0,DST:0,K:0 };
      for (const pl of remainingPlayers) remainingByPos[pl.pos] = (remainingByPos[pl.pos]||0)+1;
  
      for (let i = 1; i <= picksToNext; i++) {
        const pickOverallOffset = i; // who picks i ahead of you
        // Determine which seat picks: snake order mapping from current seat is messy; we approximate round-robin here.
        // In practice, we don't need exact seat; we aggregate average tendencies.
        // If exact seat mapping is desired, pass a schedule of seat indices instead.
        const seat = i % nTeams; // dummy; using averaged tendencies below
  
        // Aggregate averaged per-seat demand
        let demand = { QB:0,RB:0,WR:0,TE:0,DST:0,K:0 };
        let seatsCounted = 0;
        for (let s = 0; s < opponents.length; s++) {
          if (s === youSeatIndex) continue; // skip your seat
          const opp = opponents[s];
          if (!opp || !opp.have || !opp.startersFilled) continue;
          seatsCounted++;
          for (const pos of positions) {
            const startersNeed = Math.max(0, (STARTERS[pos]||0) - (opp.startersFilled[pos]||0));
            const flexNeed = (FLEX_ELIGIBLE.has(pos) && (opp.haveFlex||0) < (STARTERS.FLEX||0)) ? 1 : 0; // 0/1 flag
            const benchSlack = Math.max(0, (opp.benchCap||7) - (opp.benchTotal||0));
            const benchNeed = benchSlack > 0 ? 0.25 : 0; // light bench tendency
            const availabilityPrior = Math.max(0.1, (remainingByPos[pos]||0) / Math.max(1, remainingPlayers.length));
            demand[pos] += startersNeed + 0.5*flexNeed + benchNeed*availabilityPrior;
          }
        }
        if (seatsCounted === 0) continue;
        for (const pos of positions) demand[pos] /= seatsCounted;
  
        // Normalize to 1 pick per selection step
        const total = sum(Object.values(demand)) || 1;
        for (const pos of positions) expected[pos] += demand[pos] / total; // fractional expected picks
      }
      return expected; // e.g., {RB: 2.6, WR: 3.1, ...}
    }
  
    // ---- Tier/run awareness ----
    function runBoostedDemand(expectedTaken, remainingPlayers, opts = {}) {
      const { runBoost = 0.35, tierScarcityThreshold = 2 } = opts;
      const positions = ["QB","RB","WR","TE"];
  
      // Count players remaining by (pos,tier)
      const tiersLeft = {};
      for (const pos of positions) tiersLeft[pos] = {};
      for (const p of remainingPlayers) {
        if (!positions.includes(p.pos)) continue;
        const t = isNum(p.tier) ? p.tier : 0;
        tiersLeft[p.pos][t] = (tiersLeft[p.pos][t]||0)+1;
      }
  
      // For each pos, if the top-most tier that still has players has <= threshold, boost expectedTaken
      const boosted = { ...expectedTaken };
      for (const pos of positions) {
        const tiers = Object.keys(tiersLeft[pos]).map(n=>Number(n)).sort((a,b)=>a-b); // lower number = better tier
        if (tiers.length === 0) continue;
        const topTier = tiers[0];
        const rem = tiersLeft[pos][topTier];
        if (rem <= tierScarcityThreshold) {
          boosted[pos] = (boosted[pos]||0) * (1 + runBoost);
        }
      }
      return boosted;
    }
  
    // ---- Synergy (stacking/correlation) ----
    function synergyScore(A, B, opts = {}) {
      const w = opts.stackWeights || { QB_WR: 6, QB_TE: 5, WR_WR: -1, RB_WR: -0.5 };
      if (!A || !B || !A.team || !B.team) return 0;
      if (A.team !== B.team) return 0;
      if (A.pos === 'QB' && B.pos === 'WR') return w.QB_WR || 0;
      if (A.pos === 'WR' && B.pos === 'QB') return w.QB_WR || 0;
      if (A.pos === 'QB' && B.pos === 'TE') return w.QB_TE || 0;
      if (A.pos === 'TE' && B.pos === 'QB') return w.QB_TE || 0;
      if (A.pos === 'WR' && B.pos === 'WR') return w.WR_WR || 0;
      if ((A.pos === 'RB' && B.pos === 'WR') || (A.pos === 'WR' && B.pos === 'RB')) return w.RB_WR || 0;
      return 0;
    }
  
    // ---- Main recommendation ----
    /**
     * Suggest the next pick (refactored advanced version)
     * @param {Array} players Remaining players: [{name,pos,EV,ADP,risk?,bye?,team?,tier?,adpStd?}, ...]
     * @param {Object} rs Roster state (see makeEmptyRosterState)
     * @param {number} nTeams League size (e.g., 8 or 12)
     * @param {number} roundNumber Current round (1-based)
     * @param {number} pickInRound Your pick number within the round (1-based)
     * @param {Object} opts Options
     *   - kDstGatingRound: number (default 10)
     *   - kDstGateAtNextPick: boolean (default true)
     *   - riskLambda / riskLambdaByRound: number | (round)=>number
     *   - byePolicy: {maxSameByeStarters, basePenalty, scaleByRound, totalRounds}
     *   - topK: number | null  (if null => dynamic)
     *   - sigmaByPos: Object defaults
     *   - initialByPos: {QB,RB,WR,TE,DST,K}  // for dynamic replacement
     *   - scoring: {ppr, tePremium}
     *   - seatIndex: number (0..nTeams-1)
     *   - opponents: Array[nTeams] minimal roster snapshots (optional)
     *   - runBoost, tierScarcityThreshold (run awareness)
     *   - stackWeights (synergy)
     *   - benchPlan: target bench mix (optional hint)
     *   - mc: { sims:number }  // optional lightweight Monte Carlo (future extension)
     * @returns {{top:Array, replacement:Object}}
     */
    function suggestPick(players, rs, nTeams, roundNumber, pickInRound, opts = {}) {
      // Normalize roster snapshot to protect against missing or stale fields
      rs = normalizeRosterState(rs);
      const {
        kDstGatingRound = 10,
        kDstGateAtNextPick = true,
        topK = null,
        sigmaByPos = { QB: 10, RB: 7, WR: 8, TE: 9, DST: 12, K: 14 },
        initialByPos = null,
        scoring = { ppr: 1.0, tePremium: 1.0 },
        seatIndex = 0,
        opponents = null,
        runBoost = 0.35,
        tierScarcityThreshold = 2,
        stackWeights = { QB_WR: 6, QB_TE: 5, WR_WR: -1, RB_WR: -0.5 },
        mc = { sims: 0 }
      } = opts;
  
      const remaining = players
        .filter(p => p && typeof p.pos === "string")
        .map(p => ({
          name: String(p.name ?? "").trim(),
          pos: String(p.pos ?? "").trim().toUpperCase(),
          EV: toNum(p.EV, 0),
          ADP: isNum(p.ADP) ? p.ADP : toNum(p.ADP, NaN),
          risk: toNum(p.risk, 0),
          bye: p.bye ?? null,
          team: p.team ?? null,
          tier: isNum(p.tier) ? p.tier : null,
          adpStd: isNum(p.adpStd) ? p.adpStd : null
        }))
        .filter(p => canDraftPos(rs, p.pos));
  
      // Base replacement lines on dynamic scarcity when available
      const rep = replacementLevelsAdvanced(remaining, nTeams, { initialByPos });
  
      // Compute current VOR with roster fit, risk, and bye penalties
      const withVOR = remaining.map(p => {
        const adjEV = p.EV - riskPenalty(p, roundNumber, opts) - byePenaltyFor(p, rs, roundNumber, opts);
        const vor = adjEV - (rep[p.pos] || 0);
        const w = rosterFitWeight(p.pos, rs, { scoring });
        return { ...p, VOR_adj: vor * w, VOR_now: vor * w };
      });
  
      // Sort by immediate contribution
      withVOR.sort((a, b) => (a.VOR_adj === b.VOR_adj ? (a.EV < b.EV ? 1 : -1) : (a.VOR_adj < b.VOR_adj ? 1 : -1)));
  
      // Dynamic candidate horizon
      const dynTopK = topK == null
        ? clamp(Math.max(20, Math.ceil(0.10 * withVOR.length)), 20, 80)
        : topK;
      const boundary = withVOR[dynTopK - 1]?.VOR_adj ?? -Infinity;
      const cand = withVOR.filter((x, i) => i < dynTopK || x.VOR_adj >= boundary * 0.95);
  
      // Next-pick context
      const { nextOverall, nextRoundNumber, nextPickInRound, picksToNext } = nextPickContext(roundNumber, pickInRound, nTeams);
  
      // Opponent-aware expected demand across the gap, with run boosts
      let expectedDemand = estimatePositionDemandBetweenPicks(opponents, seatIndex, picksToNext, nTeams, opts, remaining);
      expectedDemand = runBoostedDemand(expectedDemand, remaining, { runBoost, tierScarcityThreshold });
  
      // Score each candidate with look-ahead
      const scored = cand.map(A => {
        // Clone roster and apply A
        const rs2 = JSON.parse(JSON.stringify(rs));
        applyPick(rs2, A.pos);
  
        // Remaining candidates after A, with K/DST gating applied to NEXT pick if requested
        let remaining2 = remaining.filter(x => !(x.name === A.name && x.pos === A.pos));
        const gateRound = kDstGateAtNextPick ? nextRoundNumber : roundNumber;
        remaining2 = remaining2
          .filter(p => canDraftPos(rs2, p.pos))
          .filter(p => (gateRound >= kDstGatingRound) || (p.pos !== "K" && p.pos !== "DST"));
  
        const rep2 = replacementLevelsAdvanced(remaining2, nTeams, { initialByPos });
  
        // Compute VOR at next pick for each potential B
        const c2 = remaining2.map(p => {
          const adjEV = p.EV - riskPenalty(p, nextRoundNumber, opts) - byePenaltyFor(p, rs2, nextRoundNumber, opts);
          const vor = adjEV - (rep2[p.pos] || 0);
          const w = rosterFitWeight(p.pos, rs2, { scoring });
          const VOR_next = vor * w;
          return { ...p, VOR_next };
        }).sort((a,b)=> b.VOR_next - a.VOR_next);
  
        // Survival model per B
        const baseSigmaFor = (pos, b) => (isNum(b.adpStd) ? b.adpStd : (sigmaByPos && Number.isFinite(sigmaByPos[pos]) ? sigmaByPos[pos] : 8.0));
  
        // Demand-aware adjustment: compute positional rank & adjust survival with expected demand
        const rankMaps = { QB:new Map(), RB:new Map(), WR:new Map(), TE:new Map(), DST:new Map(), K:new Map() };
        const listsByPos = { QB:[],RB:[],WR:[],TE:[],DST:[],K:[] };
        for (const b of c2) listsByPos[b.pos].push(b);
        for (const pos of Object.keys(listsByPos)) listsByPos[pos].forEach((b, idx)=> rankMaps[pos].set(b.name, idx+1));
  
        const enriched = c2.map(B => {
          const sigma = baseSigmaFor(B.pos, B);
          let survive = survivalProbADP(B.ADP, nextOverall, sigma);
          const posRank = rankMaps[B.pos].get(B.name) || 9999;
          const expTakenPos = expectedDemand[B.pos] || 0;
          survive = adjustSurvivalWithDemand(B, survive, posRank, expTakenPos);
          return { ...B, survive };
        });
  
        // Expected best-at-next using ordered survival product, including synergy bonus with A
        let probNoneHigher = 1, expNext = 0;
        for (const B of enriched) {
          const pBest = probNoneHigher * (B.survive ?? 0.5);
          const syn = synergyScore(A, B, { stackWeights });
          expNext += pBest * (B.VOR_next + syn);
          probNoneHigher *= (1 - (B.survive ?? 0.5));
          if (probNoneHigher < 1e-6) break;
        }
  
        return {
          name: A.name,
          pos: A.pos,
          EV: A.EV,
          ADP: A.ADP,
          VOR_now: A.VOR_now,
          score: A.VOR_now + expNext,
          meta: { expNext }
        };
      });
  
      scored.sort((a,b)=> b.score - a.score);
      const top = scored.slice(0,5);
  
      return { top, replacement: rep };
    }

    // ---- Roster normalization ----
    function normalizeRosterState(rs) {
      const r = JSON.parse(JSON.stringify(rs || makeEmptyRosterState()));
      const S = STARTERS;
      for (const p of ["QB","RB","WR","TE","DST","K"]) {
        r.have[p] = r.have[p] || 0;
        r.startersFilled[p] = Math.min(r.startersFilled?.[p] || 0, S[p] || 0);
      }
      const allZero = Object.values(r.startersFilled).every(x => x === 0);
      if (allZero) {
        for (const p of ["QB","RB","WR","TE","DST","K"]) {
          r.startersFilled[p] = Math.min(r.have[p], S[p] || 0);
        }
      }
      const baseSkill = (S.RB||0) + (S.WR||0) + (S.TE||0);
      const haveSkill = (r.have.RB||0) + (r.have.WR||0) + (r.have.TE||0);
      r.haveFlex = Math.min(S.FLEX || 0, Math.max(0, haveSkill - baseSkill));
      return r;
    }
  
    // ---- Public API ----
    const DraftAlgo = {
      STARTERS,
      MAX_POS,
      FLEX_ELIGIBLE,
      STREAM_FUDGE,
      makeEmptyRosterState,
      canDraftPos,
      applyPick,
      picksUntilNext,
      overallPick,
      replacementLevelsAdvanced,
      rosterFitWeight,
      survivalProbADP,
      suggestPick
    };
  
    if (typeof window !== "undefined") window.DraftAlgo = DraftAlgo;
    if (typeof globalThis !== "undefined") globalThis.DraftAlgo = DraftAlgo;
    if (typeof module !== "undefined" && module.exports) module.exports = DraftAlgo;
  })();
  