/* algorithms.js
   Fantasy Draft Algorithms (no frameworks; attach to window.DraftAlgo)
   Inputs: array of players { name, pos, EV, ADP, risk?, bye? }
   Roster state tracked separately and passed in each call.
*/
(() => {
    "use strict";
  
    // ---- League setup (from your rules) ----
    const STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1 };
    const MAX_POS = { QB: 4, RB: 8, WR: 8, TE: 3, DST: 3, K: 3 };
    const FLEX_ELIGIBLE = new Set(["RB", "WR", "TE"]);
  
    // Streaming depth bump (pushes replacement deeper -> lowers VOR early)
    const STREAM_FUDGE = { QB: 2, RB: 0, WR: 0, TE: 1, DST: 6, K: 8 };
  
    // ---- Utilities ----
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
    const isNum = (x) => typeof x === "number" && Number.isFinite(x);
    const toNum = (x, def = 0) => {
      const n = Number(x);
      return Number.isFinite(n) ? n : def;
    };
    const by = (key, dir = "desc") => (a, b) => {
      const va = a[key], vb = b[key];
      if (va === vb) return 0;
      const cmp = va < vb ? -1 : 1;
      return dir === "asc" ? cmp : -cmp;
    };
    const head = (arr, n) => arr.slice(0, Math.max(0, n));
  
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
  
    // ---- Core math ----
    // Snake format: how many picks until your next turn (not counting your next pick)
    function picksUntilNext(pickInRound, roundNumber, nTeams) {
      return (roundNumber % 2 === 1)
        ? 2 * (nTeams - pickInRound)   // odd round
        : 2 * (pickInRound - 1);       // even round
    }
  
    // ADD: current overall pick index (1-based)
    function overallPick(roundNumber, pickInRound, nTeams) {
      const within = (roundNumber % 2 === 1)
        ? pickInRound
        : (nTeams - pickInRound + 1);     // reversed
      return (roundNumber - 1) * nTeams + within;
    }
  
    // Determine position replacement EVs given remaining players and league size
    function replacementLevels(players, nTeams) {
      const byEV = (a, b) => (a.EV === b.EV ? 0 : a.EV < b.EV ? 1 : -1);
  
      const flexPool = head(
        players.filter(p => FLEX_ELIGIBLE.has(p.pos)).sort(byEV),
        nTeams
      );
  
      const flexShare = { RB: 0, WR: 0, TE: 0 };
      if (flexPool.length > 0) {
        const counts = { RB: 0, WR: 0, TE: 0 };
        for (const p of flexPool) counts[p.pos] = (counts[p.pos] || 0) + 1;
        for (const k of Object.keys(flexShare)) {
          flexShare[k] = counts[k] / nTeams;
        }
      }
  
      const rep = {};
      for (const p of ["QB", "RB", "WR", "TE", "DST", "K"]) {
        let base = nTeams * (STARTERS[p] || 0);
        if (FLEX_ELIGIBLE.has(p)) base += nTeams * (flexShare[p] || 0);
        const k = Math.max(1, Math.floor(base + (STREAM_FUDGE[p] || 0)));
  
        const pool = players.filter(x => x.pos === p).sort(byEV);
        rep[p] = pool.length >= k ? pool[k - 1].EV : 0;
      }
      const flexCand = players.filter(p => FLEX_ELIGIBLE.has(p.pos)).sort(byEV);
      rep["FLEX"] = flexCand.length >= nTeams ? flexCand[nTeams - 1].EV : 0;
      return rep;
    }
  
    function rosterFitWeight(pos, rs) {
      const startersOpen = rs.startersFilled[pos] < (STARTERS[pos] || 0);
      const flexOpen = FLEX_ELIGIBLE.has(pos) && rs.haveFlex < STARTERS.FLEX;
      if (startersOpen) return 1.00;
      if (flexOpen) return 0.85;
  
      const depthAtPos = rs.have[pos] - rs.startersFilled[pos];
      return Math.max(0.25, 0.60 - 0.07 * depthAtPos);
    }
  
    // Prob a player survives the next X picks based on ADP
    function survivalProb(adpOverall, thresholdPick, sigma = 8.0) {
      if (!(typeof adpOverall === "number" && Number.isFinite(adpOverall))) return 0.5;
      const z = (thresholdPick - adpOverall) / sigma; // +z ⇒ more likely already taken
      const pGone = 1 / (1 + Math.exp(-z));
      return Math.max(0, Math.min(1, 1 - pGone));
    }
  
    // ---- Main recommendation ----
    /**
     * Suggest the next pick.
     * @param {Array} players Remaining players: [{name,pos,EV,ADP,risk?,bye?}, ...]
     * @param {Object} rs Roster state (see makeEmptyRosterState)
     * @param {number} nTeams League size (e.g., 8 or 12)
     * @param {number} roundNumber Current round (1-based)
     * @param {number} pickInRound Your pick number within the round (1-based)
     * @param {Object} opts Options
     *   - minRoundKDst: number (default 10) // delay K/DST until this round
     *   - riskLambda: number (default 0.0)
     *   - byePenalty: number (default 0.0) // apply externally only when you detect same-bye clustering
     *   - topK: number (default 20) // candidate set for look-ahead
     *   - sigmaByPos: Object (default null) // position-specific sigma values for survival probability
     * @returns {{top:Array, replacement:Object}} top: ranked list (top 5), replacement: EV baselines
     */
    function suggestPick(players, rs, nTeams, roundNumber, pickInRound, opts = {}) {
      const {
        minRoundKDst = 10,
        riskLambda = 0.0,
        byePenalty = 0.0,
        topK = 20,
        sigmaByPos = null
      } = opts;
  
      // Defensive cloning & normalization
      const remaining = players
        .filter(p => p && typeof p.pos === "string")
        .map(p => ({
          name: String(p.name ?? "").trim(),
          pos: String(p.pos ?? "").trim().toUpperCase(),
          EV: toNum(p.EV, 0),
          ADP: isNum(p.ADP) ? p.ADP : toNum(p.ADP, NaN),
          risk: toNum(p.risk, 0),
          bye: p.bye ?? null
        }))
        // filter out positions at cap
        .filter(p => canDraftPos(rs, p.pos))
        // delay K/DST before threshold round
        .filter(p => (roundNumber >= minRoundKDst) || (p.pos !== "K" && p.pos !== "DST"));
  
      const rep = replacementLevels(remaining, nTeams);
  
      // Adjusted VOR per candidate
      const withVOR = remaining.map(p => {
        const adjEV = p.EV - (opts.riskLambda || 0) * (p.risk || 0) - (opts.byePenalty || 0);
        const vor = adjEV - (rep[p.pos] || 0);
        const w = rosterFitWeight(p.pos, rs);
        return { ...p, VOR_adj: vor * w };
      });
  
      // Sort by immediate contribution
      withVOR.sort((a, b) => (a.VOR_adj === b.VOR_adj ? (a.EV < b.EV ? 1 : -1) : (a.VOR_adj < b.VOR_adj ? 1 : -1)));
  
      // 1-step look-ahead using survival odds
      const picksToNext = picksUntilNext(pickInRound, roundNumber, nTeams);
      const currOverall = overallPick(roundNumber, pickInRound, nTeams);
      const nextOverall = currOverall + picksToNext + 1;
      
      const cand = withVOR.slice(0, topK);
      const baseSigma = 8.0;
      const sigmaFor = (pos) => (opts.sigmaByPos && Number.isFinite(opts.sigmaByPos[pos]))
        ? opts.sigmaByPos[pos] : baseSigma;

      const scored = cand.map(A => {
        // clone roster, apply A
        const rs2 = JSON.parse(JSON.stringify(rs));
        applyPick(rs2, A.pos);

        // remaining candidates after A
        const remaining2 = remaining
          .filter(x => !(x.name === A.name && x.pos === A.pos))
          .filter(p => canDraftPos(rs2, p.pos));

        const rep2 = replacementLevels(remaining2, nTeams);

        const c2 = remaining2.map(p => {
          const adjEV = p.EV - (opts.riskLambda || 0) * (p.risk || 0) - (opts.byePenalty || 0);
          const vor = adjEV - (rep2[p.pos] || 0);
          let w = rosterFitWeight(p.pos, rs2);
          return {
            ...p,
            VOR_next: vor * w,
            survive: survivalProb(p.ADP, nextOverall, sigmaFor(p.pos))
          };
        }).sort((a,b)=> b.VOR_next - a.VOR_next);

        // expected best-at-next using independence approximation
        let probNoneHigher = 1, expNext = 0;
        for (const B of c2) {
          const pBest = probNoneHigher * (B.survive ?? 0.5);
          expNext += pBest * B.VOR_next;
          probNoneHigher *= (1 - (B.survive ?? 0.5));
          if (probNoneHigher < 1e-6) break;
        }

        return { 
          name: A.name, 
          pos: A.pos, 
          EV: A.EV, 
          VOR_adj: A.VOR_adj, 
          VOR_now: A.VOR_adj,
          ADP: A.ADP, 
          score: A.VOR_adj + expNext 
        };
      });

      scored.sort((a,b)=> b.score - a.score);
      const top = scored.slice(0,5);
  
      return { top, replacement: rep };
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
      replacementLevels,
      rosterFitWeight,
      survivalProb,
      suggestPick
    };
  
    // UMD-ish expose
    if (typeof window !== "undefined") window.DraftAlgo = DraftAlgo;
    if (typeof globalThis !== "undefined") globalThis.DraftAlgo = DraftAlgo;
    if (typeof module !== "undefined" && module.exports) module.exports = DraftAlgo;
  })();
  