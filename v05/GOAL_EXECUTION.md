# Goal execution (evaluation, not release acceptance)

`asc-v05 goal-plan owner-plan.json` validates an explicit owner plan and prints dependency batches. `asc-v05 run-goal external-owner-request.json` executes it. The request must remain outside the candidate repository. Ordinary single-Goal `run` remains available; small changes do not require a multi-unit plan.

The run request retains the existing `repo`, `base`, `contract`, model, provider executable, verification assets and Draft delivery settings. Add:

- `goal`: `{schema:"asc-goal/v1", intent, units}`. Its intent must equal the whole-Goal contract.
- Each unit: `id`, `intent`, nonempty `criteria`, `dependsOn`, exact relative `readPaths`/`writePaths`, and `contracts` mapping shared contract names to SHA-256 blob digests.
- `contractFiles`: shared names mapped to `{path}` within Git. The host recalculates the blob hashes before work and after integration; a changed contract stops for replanning.
- `unitRequests`: each unit ID mapped to its own existing workflow `contract` and, when needed, host-owned authority configuration. Intent, criteria and write scope must match the plan. Whole-Goal risks cannot silently disappear; verification policy and pinned assets must match.
- `parallelism`: 1–4, default 2. This is bounded concurrency, not a fixed total Agent count.

Cycles, missing dependencies, conflicting read/write scopes without declared ordering, inconsistent shared contract generations and out-of-Goal writes are rejected. `readPaths` is a dependency declaration, **not an OS read restriction**: each Agent still receives a full bounded source snapshot. Unknown semantic dependencies require owner/design clarification; the planner does not infer them from filenames.

Each execution group uses independent non-shared clones. Each unit is implemented, verified and independently reviewed. The host waits for every started unit in the group to finish. If one fails, that group is not integrated and no Delivery occurs; earlier successful groups remain as inspectable Git commits. Do not interpret this as atomic rollback of the entire Goal.

Integration uses observed Git blobs, only from the declared write scope. The final workflow starts a new controller and repeats whole-Goal verification and fresh independent review before Draft PR/CI. Unit reviews cannot satisfy this final gate. An additional Agent is used only for actual implementation/repair or independent review, not per logical Step.

Authority commands are host programs, never candidate or Git metadata programs. Goal execution checks all effective unit commands before cloning, including future paths and aliases. Executable/file operands must be absolute paths; bare flags are permitted. Do not put inline script code, relative script paths, or candidate files in authority arguments. Approvals still require valid pinned signatures for the actual contract/base/run.

`affectedUnits` in `src/goal-plan.mjs` computes changed units and their dependent closure. Its result is a revalidation plan, not reusable evidence. Current `run-goal` requires the clean starting HEAD; saved logs cannot serve as approval or completion authority. `restart-goal` preserves a partly integrated source and reconstructs a clean-baseline execution; the interrupted Goal restart and delegated replanning sections below describe candidate reuse and its limits. Broad recovery acceptance remains incomplete. No daemon, GraphDB or persistent cache is introduced.

Tests with Agent/provider doubles establish execution ordering and gate behavior, not live model quality or real GitHub delivery. Real experiments must separately record package digest, exact HEAD, all observed calls, failures, wall time and missing usage. Synthetic internal modules do not prove deployed multi-service operation.

## Real model evidence

Historical `NODE_*_EVIDENCE.json` names below identify private evaluation records,
not files shipped in this repository. They are not publicly reproducible evidence.
The selected complex/replanning summaries in `RELEASE_READINESS.json` explicitly
retain their historical product HEADs and limits; they do not certify this HEAD.


A matched local screen/API/SQLite comparison used direct/adaptive/adaptive/direct order, two trials per mode, with identical owner input, pinned oracle and executable product source. Direct execution averaged 198.68 seconds and 258,776.5 observed processed tokens; delegated decomposition averaged 233.46 seconds and 342,933 tokens. Both modes passed verification and independent review without repair; adaptive selected one cohesive unit and added one proposal call. Keep ordinary `run` available for an already scoped single change; do not require decomposition merely to execute it. This small sample ends before external Delivery and does not establish general speedup, all-Agent cost, or equivalence to v0.4. Raw bindings and conditions are in `NODE_VERTICAL_SLICE_EVIDENCE.json` under `matchedScreenExecutionComparison`.

`NODE_GOAL_EVIDENCE.json` records a three-unit synthetic checkout: pricing and inventory execute in parallel, checkout depends on both, then a new whole-Goal reviewer inspects the integration. The successful run reached Draft PR66 and CI in 307.152 seconds with seven fresh contexts. A preceding 105.483-second attempt failed on GitHub connectivity; its completed pricing work was not integrated. Both observations remain recorded. The seven declared successful calls total 647,538 observed processed tokens; provider-wide completeness is not asserted. This is not a matched speed comparison or proof of deployed multi-service quality.

## Restart using old output as candidate data

Optional `unitCandidates` maps a unit ID to `{repo, base, head, contractDigest}`. These are explicit host-owned input references to Git objects; no old result file, approval, test result or reviewer verdict is imported. `contractDigest` equals the digest of the current unit contract and is an input consistency check, not signed provenance.

The host refuses a candidate whose source diff exceeds unit write scope. A changed contract invalidates import, and changed write preimages prevent overwriting newer edits. Changed read inputs may retain candidate bytes, but never old verification or review authority. High-risk/design-approved candidates are imported only after fresh owner approval and current binding checks, as described below. New isolated verification and fresh independent review are mandatory for every imported candidate. Unknown or undeclared dependencies are not proven unchanged by this check; the new reviewer must inspect semantic suitability.

This supports explicit restart from a clean base after a failed group, without repeating implementation of a compatible successful unit. It does not resume a partly integrated root in place or reuse old approval/review authority. `restart-goal` can select candidate references from saved diagnostics into a new clean-baseline clone; those diagnostics do not grant authority. Reverification costs remain intentional. The historical PoC driver `node_goal_recovery_trial.mjs` targeted only its disposable experiment; it is not a command in this checkout or installed package.

`NODE_GOAL_RECOVERY_EVIDENCE.json` records recovery of the actual network-timeout attempt: six new contexts reached Draft PR67/CI in 289.340 seconds. Pricing reused candidate bytes but received fresh verification/review. The prior 105.483-second failed attempt is retained separately; adding the measured attempts does not include the operator gap and is not calendar E2E time.

After these additions, two sequential small-change runs retained the ordinary two-context route and reached Draft/CI in 91.443 and 90.478 seconds. Executable files were identical across those trials (`NODE_SMALL_REGRESSION_EVIDENCE.json`). This does not establish superiority over old ASC or no-ASC controls.

## Parallel controller scheduling

Live default-provider units use separate trusted Node controller threads, so synchronous Git and verification in one unit cannot starve another unit's network-preflight event loop. These threads are not a permission boundary: Agent tools and candidate tests still use the existing OS sandbox. The parent waits for thread exit, rejects missing results and abnormal exits even after a result message, and checks all returned context identities before integration. The final reviewer remains fresh.

Custom host callback providers with real Agents currently require parallelism 1; they are never silently replaced with the GitHub adapter. Injected Agent/provider doubles run in-process for deterministic unit tests. The first HTTP trial exposed the shared-event-loop failure; NODE_SERVICE_FAILURE_EVIDENCE.json retains it. No preflight timeout or isolation requirement was relaxed.

A later-group failure is also covered by a regression: the first group remains in Git, Delivery is refused, and restarting the partially integrated root is refused. An explicit new clean-baseline run can import prior unit outputs and redo all three unit reviews plus the whole-Goal review. The old root is preserved. This test uses Agent/provider doubles; it establishes the candidate-data recovery path, not real-model quality, automatic in-place resume, or production recovery acceptance. Internal unit, import and integration workspaces use separate namespaces, so legal unit IDs cannot collide with host workspace names.

## HTTP service failure and explicit recovery

`NODE_SERVICE_REVIEW_FAILURE_EVIDENCE.json` records the threaded three-service trial: pricing/inventory integrated, but checkout exhausted its repair allowance after independent protocol and documentation findings. No Draft was created. The 902.458-second CLI interval and ten observed contexts remain recorded.

`NODE_SERVICE_RECOVERY_EVIDENCE.json` records explicit host recovery into a separate clone through ordinary `run`: fresh signed dummy approval, whole-Goal verification, review, repair, fresh review and Draft PR74/CI. The whole-Goal reviewer also found an inventory route defect missed by unit review. Recovery took 510.318 seconds and three contexts. This is a fresh whole-Goal review, not repeated unit reviews or automatic Goal resume. Pack/clone/preparation approval and operator gaps are outside these CLI intervals; their sum is not total recovery or development time. The earlier scheduling failure remains separate. These observations establish a concrete recovery path, not a performance improvement or production distributed-system acceptance.

## Failed-call accounting

Failed unit controllers carry their newly produced diagnostic result into the Goal result, including calls, usage or null and actual stage events. A failure remains a rejected unit; diagnostic records never count as approval or successful review. Whole-Goal workflow failures retain their diagnostics too. `node report_workflow.mjs result.json` now aggregates successful and failed unit calls and whole-Goal calls once. Missing unit diagnostics in older files stay missing, not zero, and parallel unit durations are not added to Goal wall time. Provider-wide Agent enumeration remains uncertified, so `allAgentTotalTokens` remains null.

## Multiple authorized Issues (evaluation)

`asc-v05 run-issues external-owner-issue-request.json` selects from an owner-enumerated set; it does not discover or authorize arbitrary GitHub Issues. Input is `{schema:"asc-issues/v1", intent, parallelism, budget, issues}`. Each Issue has `id`, `dependsOn`, `readPaths`, optional integer `priority` (higher first), and its ordinary `request` for `run` or `run-goal`. Use a dedicated worktree and distinct delivery branch per Issue. The request file must be outside every candidate. The whole set shares the optional execution budget; per-Issue budgets are rejected instead of silently ignored.

The existing dependency compiler checks cycles and declared read/write conflicts within the same owner-declared GitHub repository. Required policy references also count as reads. These declarations do not prove absence of unknown semantic/API/DB dependencies. Specify those dependencies and retain their normal validation. Distinct ready Issues run up to the requested concurrency; an overlapping actual worktree waits instead of creating a global reservation. Invalid work locations and failed/approval-blocked Issues are recorded individually. Only their dependents are blocked; independent Issues continue. A new invocation recomputes work and never imports this result as review or completion authority.

This schedules existing development paths and provides separate Draft deliveries. Dependency ordering does **not** transfer code, merge PRs, or update another Issue's base. Code-dependent integration remains explicit owner work or an existing `run-goal` unit integration; the queue must not be described as complete automatic cross-Issue integration/replanning. The current implementation still needs adversarial and live multi-Issue acceptance before release.

複数Issueの承認コマンドは、全候補worktreeとGit管理領域の外部に置く。親要求とGoal unitの承認コマンドを起動前・dispatch時に検査し、違反Issueとその依存先だけ停止する。候補の未作成ファイルやaliasも承認コードの出自として認めない。

## Optional Goal decomposition proposal

`asc-v05 goal-propose <external-owner-request.json>` uses one read-only isolated
Agent when a complex Goal needs decomposition. It is optional: ordinary `run`
does not incur a planner call. The request supplies the same explicit `repo`,
`base`, `codexExecutable`, `model`, `contract` and optional `budget` fields.
`contractFiles` may map names to `{ "path": "relative/path" }`; the controller
computes their pins from the observed commit. The source must be clean.

The output is either `proposed` or `needs-owner`. A proposal contains a DAG of
user-value Work Units and the observed source/owner-contract binding. It grants
no authority, imports no receipts, changes no repository and performs no
Delivery. Unknown approvals and executable configuration from the model are
not propagated. Out-of-scope writes, invented contract pins and conflicting
units without dependencies are rejected. Snapshot changes are rejected.

The owner must adopt the proposal into the existing `run-goal` request, including
explicit unit verification contracts. Structural validation does not establish
semantic coverage of the original acceptance criteria; independent review must
still assess it. Automated adoption, automatic unit test-command synthesis and
cross-session continuation are not provided by this command. One isolated real-Agent inventory trial proposed search and reservation slices
in 32.79 seconds (1 call, 32,043 observed processed tokens). See
`NODE_GOAL_PROPOSAL_EVIDENCE.json`. This tests proposal output only; semantic
coverage beyond this fixture and general autonomous adoption remain unverified.

The model-proposed checkout integration trial is recorded in
`NODE_PROPOSED_GOAL_EVIDENCE.json`. Its first run stopped: the proposal required
full-suite evidence, but the fixture adopted only unit-test commands. The
independent reviewer refused to pass; a code-only repair could not satisfy the
missing verification. This is a failed trial, not successful autonomous adoption.
The fixture now selects the full existing suite and runs fixed assertions under
an isolated Python parent that requires a completion marker. An early successful
Node exit, wrong result and candidate Python import shadowing are regression
cases. This marker does not prove immunity to arbitrary malicious output forgery.
The historical PoC driver `node_proposed_goal_cli_trial.mjs` used an explicit fixture-owner adoption
policy (not shipped in this checkout or package), not a general policy for converting model proposals into authority.


The corrected checkout trial reached real Draft PR91 and matching CI at
`c79868a3e42efcf450cc4b67a7469c4981dfcb12`. It used one proposal call, three
implementation calls and four independent review calls, with no repair in the
corrected attempt. Proposal time was 33.965 seconds; execution CLI time was
269.729 seconds. The eight declared calls recorded 588,105 processed tokens and
94,921 fresh tokens. Preparation and issue-creation gaps were not measured as
one interval, so their sum is not a measured request-to-CI total. The preceding
failed trial is preserved. This demonstrates fixture-policy adoption and
integration, not general automatic approval or a matched performance advantage.


## Owner-delegated decomposition

`asc-v05 run-adaptive external-owner-request.json` composes proposal and Goal
execution when the owner explicitly supplies `decomposition.mode` as
`within-owner-contract`. Ordinary `run` does not start a planner.
`decomposition.unitChecks` contains `{paths, argvs}` rules covering every allowed
path. These are owner-supplied verification commands, not commands generated by
the model. Rules intersecting a unit's write paths become its additional checks;
the whole-Goal test command remains unchanged. By default each unit inherits
that test command, preserving existing requests. If it requires other units to
be complete, the owner may explicitly set `decomposition.unitTestArgv` to a
nonempty argv array for the unit baseline. The model cannot select or replace
this command. Selected per-path `unitChecks` still run in addition to that
baseline. After integration the original whole-Goal `testArgv` and
`riskTestArgv` run unchanged, followed by fresh whole-Goal review. No passing
unit check replaces this integration evidence. A failed check stops execution
rather than being relaxed.

The proposal can choose units and dependencies only within the original scope.
It cannot replace authority, assets, policy, risk requirements or Delivery.
Original Goal acceptance is verified after integration with a fresh reviewer.
Unresolved owner decisions stop before implementation. Proposal and execution
share a call/time admission budget, and the planner context cannot become an
implementation or review context. Reports include the proposal's observed usage
once; missing usage remains unknown. The `run-issues` worker also accepts this
explicit delegation without adding it to other Issues.

The first live packaged run-adaptive trial stopped safely after 152.214 seconds
with six observed calls and 410,012 processed tokens. Both initial unit outputs
used CommonJS in an ESM project; one repair fixed this, the other reached its
repair limit. No batch was integrated or PR created.
`NODE_ADAPTIVE_GOAL_EVIDENCE.json` preserves this failure. Verification failures
now provide bounded untrusted output excerpts to repair, rather than only hashes.
Timeout/output-limit exceptions still stop without these excerpts. The subsequent product-path trial is recorded below; prior fixture-policy
success is distinct.


The next installed `run-adaptive` trial completed Draft PR94 and matching CI at
`91e4eed50da1b28ab7e129d45da2cd562610e84e`. CLI wall time was 303.549 seconds;
the measured interval including Issue creation was 304.866 seconds. Eight calls
(one proposal, three implementations, four independent reviews) recorded
535,336 processed tokens and 123,816 fresh tokens. No repair occurred, so this
repeat does not establish the causal benefit of failure diagnostics. Both trials
remain in `NODE_ADAPTIVE_GOAL_EVIDENCE.json`. This is product-path completion on
the synthetic fixture, not general release or comparative-performance acceptance.

## Interrupted Goal restart

`asc-v05 restart-goal <external-owner-request.json>` accepts the original owner
request plus `restart: {directory, resultFile, budget?}` (absolute paths). The directory
must be new. Preparation preserves the partial source and creates an independent
clone at the original base. The saved result selects candidate Git bytes only;
it supplies no approvals, review receipts, commands, or Delivery authority.
Completed unit candidates undergo their current unit checks and fresh independent
review; unfinished units execute normally, followed by whole-Goal verification
and review. Read-input changes alone may retain untrusted candidate bytes when
the unit contract and write preimages still match. They never retain old test or
review authority: current tests and fresh review decide whether repair is needed.
Changed write preimages refuse import so newer destination edits are not overwritten.
Changed contracts require new implementation. High-risk units require fresh owner
approval before compatible candidate bytes may be imported. An adaptive restart
revalidates its saved proposal binding unless explicit delegated replanning creates
a new proposal under the current owner contract.

Approval commands are checked against both source and destination, including Git
metadata, before cloning. High-risk preparation grants no approval: execution
still requires fresh owner approval. A changed unit contract or write preimage
invalidates candidate import and falls back to fresh implementation under the
current contract. Invalid references, scope violations, stale proposal bindings,
or failed approval stop execution. Explicit `restart.replan: true` enables the bounded delegated
replanning described below; unrequested repeated replanning and cumulative cross-run
budget accounting are not provided. For a bounded original request, the owner must supply `restart.budget` with every previously bounded dimension (`maxAgentCalls` and/or `maxElapsedSeconds`). Copying the original request alone never renews its allowance. The explicit allowance applies to the new run; prior result usage cannot grant budget. This is not cumulative cross-session accounting. An originally unbounded request may remain unbounded. Failed
preparation leaves created files for inspection rather than resetting any source.

## Review assessment

The regular single fresh reviewer returns `verdict` and structured `findings`.
Each finding supplies location, triggering condition, evidence, impact, severity,
required action, considered counterevidence, verification status and whether it
blocks delivery. The controller rejects contradictory verdicts and nonblocking
P0/P1 findings. It records the assessment against the current target, contract
(including verification configuration) and reviewer context. Repair receives the
structured assessment; subsequent review observes the new target.

This is format/consistency validation, not proof that the finding is true or that
all defects were detected. The read-only reviewer cannot execute candidate code;
its verification status is `static-analysis` or `unverified-risk`. Neither is a
Host-confirmed reproduction. Existing Host test results remain separate evidence.
No additional reviewer is started merely to populate fields. Comparative review
precision, recall and severity calibration remain unverified.

Restart rejects malformed/duplicate saved unit entries, invalid explicitly supplied Goal plans, missing required proposals, and an already existing restart-request file before creating the clone. This avoids leaving a destination occupied by those input errors. The final exclusive write still refuses concurrent replacement; later candidate Git or adaptive adoption failures can retain a clone for inspection. This is not transactional rollback of every possible restart failure.

An owner-replanning integration regression changes the shared contract for unit `a` and its dependent `sum`, while independent `b` keeps its contract and declared inputs. Execution invalidates the old `a` output, reimplements `a` and `sum`, and imports only `b` candidate bytes. All three units and the integrated Goal receive new verification and fresh review. This uses Agent/provider doubles and does not prove autonomous semantic replanning, real-model review quality, or production Delivery.

Dependent Issues require their declared upstream bytes in the downstream worktree.
If missing, only that Issue stops; independent siblings can finish. The owner may
integrate the verified upstream commit and explicitly update the downstream base,
then invoke the Issue Goal again. This does not import old review/CI receipts:
existing candidates get current verification and fresh review, while the missing
downstream implementation runs normally. A real-Git/isolated-verification regression
covers this sequence and preservation of upstream/sibling HEADs. Its Agent and
GitHub responses are doubles; real-model dependent-Issue Draft/CI remains unverified.

The historical PoC driver `evaluation/check-dependent-issues.mjs` (not shipped
in this checkout or package) repeated this dependency recovery with real
Codex contexts and isolated checks. The initial dependent Issue stops before Agent
dispatch; after fixture-owner integration only it is implemented, and all three
Issues receive fresh reviews without changing the two completed candidate HEADs.
`NODE_MULTI_ISSUE_EVIDENCE.json#dependentRecoveryLive` preserves the 126.660-second
trial and eight contexts. Delivery/CI are explicit local doubles: their internal
`draft-ci-passed` values are not external GitHub evidence. This sequential dummy
trial does not prove automatic integration or parallel live-model acceptance.


Final integration retains the parent's verification commands and adds distinct
Unit test and risk-test commands. They run against the integrated candidate and
again after any final repair, before whole-Goal review and Delivery. Earlier Unit
success does not authorize changed integrated bytes. Identical additional argv
are deduplicated; the parent's explicit checks are preserved. This adds no Agent,
but necessary final Unit checks add verification time.

The final contract also retains parent and Unit acceptance criteria and intents,
all declared risks, and required Unit designs. A Unit requiring design approval
must use the same effective approval command and trusted key set as the Goal;
different authorities require explicit owner replanning before any Agent starts.
Key-set ordering does not change authority. This does not support combining
approvals from separate owners. Child approval receipts never authorize final
repair or Delivery.

The composed final contract includes these commands, so its digest may differ
from the parent contract. An owner approval adapter receives that exact contract
and binding and must authorize it explicitly when approval is required. A
signature for the old parent contract is not reused. Owners whose adapters use
contract allowlists must include the composed final contract; refusal remains
fail-closed. Unit checks must remain meaningful for the integrated Goal; changing
an obsolete obligation requires an explicit owner contract/plan revision.

For multi-Unit work, the host passes the compiled assignment to implementation and review: current capability, other assigned capabilities, dependencies, scopes and integrated/pending state. A Unit review must not require explicitly pending work to be finished early. It still checks broken dependencies, shared invariants and contradictions. This context cannot authorize Delivery; final verification and fresh review assess the complete Goal without deferred obligations. No additional Agent is created for this information.

When a Goal has exactly one Unit with the same scope and execution policy, no
candidate import, no Unit-specific runner settings and no writable shared pins,
execution uses one combined contract directly in the target worktree. Parent
Intent remains unchanged; Unit Intent and criteria are added to the acceptance
criteria. Parent and Unit checks all remain required. The implementation and a
fresh independent review run once; no Unit review receipt is reused and no
integration copy creates a second HEAD. Different authority or policy retains
the existing Unit/integration path. Any required approval binds the combined
contract, not a previous parent signature. An empty candidate map, or a well-formed
reference whose Unit contract digest no longer matches, does not require the
separate Unit/integration path: no old bytes or Evidence are imported. Malformed
Git references still fail. A contract-matching candidate retains the existing
import, fresh validation and independent integration path.

A failed direct execution preserves its candidate commit in the target worktree
and diagnostic output; it does not reset the user's worktree. Delivery remains
blocked. Use the explicit restart/replan path for a new attempt; candidate
preservation is not permission to reuse old verification or review evidence.
Usage is recorded under the combined workflow once. Boundary tests cover both
contracts' checks, context reuse, private provider methods and shared-pin drift.
The matched direct/adaptive trials above measure current execution costs. A local
stale-candidate restart comparison used baseline/optimized/optimized/baseline order,
two trials per version, with the same owner request, model and hashed oracle.
Mean time was 251.50 -> 215.90 seconds; calls per trial were 4 -> 3; mean observed
processed tokens were 419,716 -> 330,546 (fresh 110,788 -> 87,922). All four passed
without repair; the optimized path retained both verification commands and one
whole-Goal review. Generated plans/code and cache utilization differed. This small
nonrandomized sample is not a causal or general speedup estimate, v0.4 comparison
or external PR/CI acceptance; see NODE_VERTICAL_SLICE_EVIDENCE.json,
singleUnitReplanOptimization.repeatedComparison.
Combined runs also record observed candidate commit/base and the original Unit
contract digest after failure. Explicit restart may pass those bytes through the
existing candidate importer; scope, write preimages and current contract are
checked again. Dirty or out-of-scope output is not recorded as a candidate.
Candidate data never transfers approval or review: restart currently uses fresh
Unit and whole-Goal verification/review. High-risk candidate import is deferred
until the current Unit obtains fresh owner design approval. The approved Controller
checks the current contract, scope and write preimages before importing bytes; it
then runs current verification and fresh review. No old approval is imported.
Missing or denied approval stops that Unit before import or Agent dispatch.
The independent whole-Goal approval and verification remain required. Review-only
API calls cannot import candidate bytes.

Failed multi-Unit work also records its candidate Git binding when the host can
observe clean, in-scope output. The failure remains a failure; restart imports
bytes only and reruns verification, bounded repair, and fresh review. Dirty or
out-of-scope output is not exported as a candidate. High-risk work retains the
fresh owner-approved execution rule.


### Delegated replanning on restart

An original adaptive request may explicitly set `restart.replan: true`. This
requires the existing `decomposition.mode: "within-owner-contract"` delegation;
explicit `goal`/`unitRequests` requests cannot opt into it. Preparation still
preserves the original source and creates a new clean-baseline clone. A single
fresh read-only planner receives bounded, untrusted prior Unit failure summaries
and, when structurally valid and at most 64 KiB, a field-projected prior plan.
It compares this advisory plan with the current owner contract, retaining unchanged
Unit IDs and acceptance wording only where still correct. Malformed or oversized
prior plans are omitted. It proposes a new decomposition under the original owner
contract. The old
proposal is not adopted or relabeled as fresh work.

The existing adoption checks preserve owner scope, verification commands, policy,
risk, approval and Delivery authority. Matching Unit IDs only select old candidate
Git objects; the existing import checks decide compatibility and every accepted
candidate receives current verification and fresh review. A changed ID or contract
requires new implementation. The planner and execution share the explicitly renewed
restart budget, and the planner context cannot serve as implementer or reviewer.
Clarification stops before implementation. This command does not automatically
retry replanning or renew budget after failure. It does not authorize new business
requirements or cross-Issue integration. Initial control tests use Agent/provider
doubles. The live local result below covers one semantic replanning case; external
Delivery acceptance remains pending.

`RELEASE_READINESS.json` → `historicalComplexAcceptance.replanning` records restart of the actual earlier adaptive
checkout failure. The fresh planner proposed pricing, inventory and integrated
checkout under the original contract. All three units and the final integration
passed current checks and independent review in 382.871 seconds, with ten distinct
contexts and 633,389 observed processed tokens. The old inventory candidate was
invalidated because its new Unit contract differed, so this is not evidence of
candidate-reuse savings. Two ESM/CommonJS mistakes required repairs. The subsequent
configuration-reading prompt correction was not active in this trial.

The original 152.019-second failure remains recorded; the restart interval excludes
the operator gap. The final provider deliberately denied external Delivery. No Draft
or CI success is asserted. This demonstrates a bounded delegated replan and local
completion, not general autonomous production recovery or comparative speedup.

The advisory-plan hint was added after that live trial to address unnecessary
contract rewording and candidate invalidation. It carries no approval, executable
settings or verification receipt. Existing candidate import and fresh-review checks
are unchanged. The follow-up local trial below measures reuse, elapsed time and tokens.

The `historicalComplexAcceptance.advisoryPlan` record in
`RELEASE_READINESS.json`, at `f7082c8`, completed local verification/review in
257.180 seconds with seven distinct contexts and 459,742 observed processed tokens.
Inventory reused its existing candidate with current verification and fresh review;
pricing and checkout needed one implementation each and no repairs. Four final
integration commands and independent review passed against the same target. Source
HEAD/status were unchanged. External Delivery remained deliberately disabled.
Compared with the earlier observation (382.871 seconds, ten calls, 633,389 tokens),
this is promising but not causal performance acceptance: each revision ran once,
the runtime-convention prompt also changed, and planner choices can differ. Both
exclude the original failure, operator gap and PR/CI. Full regression: 187 passed,
zero failed/skipped in 102.292 seconds; independent implementation review found no
confirmed P0/P1. Broad release and all-Agent performance gates remain unmet.


## Delegated four-domain trial

At `5eabdba`, the existing adaptive runner chose four Work Units and their
dependencies for the order fixture, rather than receiving fixed Unit definitions.
Owner requirements, schema, allowed paths and executable verification remained
fixed. The Planner preserved inventory/billing independence and made order
acceptance depend on both, with reporting following order acceptance.

The local trial completed in 811.552 seconds, including the 27.305-second proposal:
ten distinct contexts (one Planner, four implementations, five reviews), no
repairs, 1,142,062 observed processed tokens and 272,430 fresh tokens. Each Unit
passed three checks; integration passed eleven. Verification, review and assessment
targets matched, with final HEAD `32d308fc195776dd3f61524e04314b2c82ffbe3b`.
The evaluation provider deliberately refused external Delivery; PR/CI did not run.
Selected aggregates and target bindings are available in
`RELEASE_READINESS.json` → `historicalComplexAcceptance.multidomainAdaptive`.
Raw artifacts remain private; their locally checked hashes are not public reproduction evidence. Independent read-only audit confirmed the metrics,
Context separation, target bindings and retained owner scope; no confirmed issue
was found within that audit scope.

This verifies bounded decomposition and sequential local execution, not autonomous
requirements/design discovery, distributed transactions or large-system release
acceptance. The fixed and adaptive trials have different Unit contracts and an
additional compile check; single-run timings do not establish a speedup. All ten
declared calls have usage, but provider-wide all-Agent usage remains unknown.

## 既定制限の採用条件（2026-10-17）

目的は要求からDraft PR・CI完了まで自走継続し、品質を保った総費用を減らすこと。個別Agentの短時間化だけを成功としない。既定制限は、終了後の成果引継ぎ・回復が成立し、同条件比較で総時間・観測tokens・成功率・再試行の費用対効果が確認できた場合に限って採用する。未取得usageは欠測として残す。利用者が指定した全体予算は更新・超過しない。

現時点の調査では、run-adaptiveは分解と実行を組み合わせるが、例外を受けた自動再計画ループを持たない。restart-goalは候補を保存して再検証する入口であり、自動で呼ばれる保証ではない。従って個別Agent期限を既定化する根拠には不足する。RELEASE_READINESSの過去比較も既定制限あり／なしの比較ではなく、総tokens欠測があるため採用根拠として流用しない。

追加の決定論的回帰試験では、4回の内容改善を経てDeliveryまで進めることと、A→B→Aという拒否済み内容の循環を新commit・新しい指摘文言でも検出できることを確認した。AgentとGitHubはテストダブルであり、モデル品質・実PR完走・実tokensの費用対効果は証明していない。

残る評価は、個別Agent終了・Context引継ぎ・循環からの再評価を含む共通fixtureについて、上限なしと候補制限ありを同じモデル・権限・テスト・レビュー・PR/CI条件で比較すること。新たな証拠が得られるまでは既定の全体時間・起動回数・個別Agent時間制限を追加しない。
