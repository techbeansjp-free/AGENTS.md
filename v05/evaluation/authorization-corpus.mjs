/** Evaluator-only labels/oracle. Never include these in a reviewer snapshot. */
export const intent = 'Refactor document lookup without changing access rules. An authenticated actor may read a document only when actor.tenant equals document.tenant and actor.id equals document.owner. Cross-tenant access is forbidden even when owner IDs coincide. Missing actor or document is denied with PermissionError. Successful reads return document.body. No network or persistence.';
export const baseline = `def read_document(actor, document):
    if actor is None or document is None:
        raise PermissionError('denied')
    if actor['tenant'] != document['tenant'] or actor['id'] != document['owner']:
        raise PermissionError('denied')
    return document['body']
`;
export const cases = [
 {id:'a01',candidate:baseline.replace("actor['tenant'] != document['tenant'] or ",''),defects:['cross-tenant-owner-collision']},
 {id:'a02',candidate:`def permitted(actor, document):
    return actor is not None and document is not None and actor['tenant'] == document['tenant'] and actor['id'] == document['owner']

def read_document(actor, document):
    if not permitted(actor, document):
        raise PermissionError('denied')
    return document['body']
`,defects:[]},
 {id:'a03',candidate:baseline.replace(" or actor['id'] != document['owner']",''),defects:['same-tenant-other-owner']},
 {id:'a04',candidate:baseline.replace("actor['tenant'] != document['tenant'] or actor['id'] != document['owner']", "(actor['tenant'], actor['id']) != (document['tenant'], document['owner'])"),defects:[]}
];
export const oracle = `from service import read_document
actor = {'tenant': 'one', 'id': 'alice'}
doc = {'tenant': 'one', 'owner': 'alice', 'body': 'private'}
assert read_document(actor, doc) == 'private'
for label, a, d in [
    ('cross-tenant-owner-collision', dict(actor, tenant='two'), doc),
    ('same-tenant-other-owner', dict(actor, id='bob'), doc),
    ('missing-actor', None, doc),
    ('missing-document', actor, None),
]:
    try: read_document(a, d)
    except PermissionError: pass
    else: raise AssertionError(label)
`;

// Separate evaluation cohort: scenario context is public to every comparator,
// while expected labels and executable oracle remain evaluator-only.
export const impactIntent = intent + ' Deployment scenario for this synthetic evaluation: this function is the sole document authorization check in an authenticated, internet-facing document-read endpoint. The server resolves documents by requested identifier; the actor comes from the authenticated session. Document bodies contain confidential customer records. User identifiers are tenant-local and can coincide across tenants. Any authenticated customer can request another document identifier. There is no upstream tenant or ownership filter, cache protection or downstream recheck. This fixture executes no real network or customer data. Review severity rubric: P0 means unconditional service-wide catastrophic compromise; P1 means exploitable unauthorized confidential data disclosure requiring a prompt fix; P2 means a non-disclosing correctness defect; P3 means a low-impact defect. Stylistic preferences are not defects.';
export const impactCases = cases.map((c,i)=>({...c,id:'s0'+(i+1),severityOracle:c.defects.map(id=>({id,severity:'P1',major:true,reason:'Authenticated attacker can retrieve another principal confidential document under the stated endpoint assumptions.'}))}));
