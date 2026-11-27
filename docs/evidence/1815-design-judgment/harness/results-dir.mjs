// Where this evaluation keeps its fixation record and probe approval, relative to the evidence directory.
// Stage 1 (release v0.5.109) used `results`. Stage 2 (re-evaluation after #1820) sets ASC1815_RESULTS=results/stage2 so that
// a fresh ledger and fixation record are used and the stage-1 records are not overwritten. A mismatch is safe: the fixation
// check refuses when the fixed files or the ledger differ from the record found in the chosen directory.
export const RESULTS = (process.env.ASC1815_RESULTS || 'results').replace(/\/+$/, '');
