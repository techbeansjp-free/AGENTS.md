/** Sequential retry/atomicity corpus; SQLite stays in memory, no external funds. */
export const intent='Refactor a single-connection SQLite transfer implementation without changing behavior. Callers supply positive integer amount, distinct existing accounts and a nonempty key; no surrounding transaction is active. Successful transfer debits and credits once and records the key. Repeating the same key and payload returns without further mutation. Reusing a key with a different payload raises ValueError. Any exception, including injected before_commit failure, leaves balances and receipts unchanged, and a later retry can succeed. This fixture models sequential calls only; no concurrency or real money.';
export const baseline=`def transfer(db, key, source, destination, amount, before_commit=lambda: None):
    db.execute('BEGIN')
    try:
        receipt = db.execute('SELECT source, destination, amount FROM receipts WHERE key = ?', (key,)).fetchone()
        if receipt is not None:
            if receipt != (source, destination, amount):
                raise ValueError('key conflict')
            db.rollback()
            return
        row = db.execute('SELECT balance FROM accounts WHERE id = ?', (source,)).fetchone()
        if row is None or row[0] < amount:
            raise ValueError('insufficient funds')
        db.execute('UPDATE accounts SET balance = balance - ? WHERE id = ?', (amount, source))
        db.execute('UPDATE accounts SET balance = balance + ? WHERE id = ?', (amount, destination))
        db.execute('INSERT INTO receipts VALUES (?, ?, ?, ?)', (key, source, destination, amount))
        before_commit()
        db.commit()
    except Exception:
        db.rollback()
        raise
`;
export const setup=`import sqlite3
from ledger import transfer
def fresh():
    db = sqlite3.connect(':memory:')
    db.executescript('CREATE TABLE accounts(id TEXT PRIMARY KEY, balance INTEGER NOT NULL); CREATE TABLE receipts(key TEXT PRIMARY KEY, source TEXT, destination TEXT, amount INTEGER); INSERT INTO accounts VALUES ("a",100),("b",0);')
    return db
def snapshot(db):
    return (db.execute('SELECT * FROM accounts ORDER BY id').fetchall(), db.execute('SELECT * FROM receipts ORDER BY key').fetchall())
`;
export const smoke=setup+`db=fresh()
transfer(db,'one','a','b',10)
assert snapshot(db)==([('a',90),('b',10)],[('one','a','b',10)])
`;
export const oracle=smoke+`transfer(db,'one','a','b',10)
assert snapshot(db)==([('a',90),('b',10)],[('one','a','b',10)]), 'retry mutated balances'
try: transfer(db,'one','a','b',11)
except ValueError: pass
else: raise AssertionError('conflicting key accepted')
db=fresh()
prior=snapshot(db)
def fail(): raise RuntimeError('injected before commit')
try: transfer(db,'two','a','b',20,fail)
except RuntimeError: pass
else: raise AssertionError('injected failure swallowed')
assert snapshot(db)==prior, 'failed transfer persisted'
transfer(db,'two','a','b',20)
assert snapshot(db)==([('a',80),('b',20)],[('two','a','b',20)])
class Row(tuple):
    def __eq__(self, other): return other is None or tuple.__eq__(self, other)
    def __ne__(self, other): return not self.__eq__(other)
db=fresh()
db.row_factory=lambda cursor, row: Row(row)
transfer(db,'three','a','b',10)
try: transfer(db,'three','a','b',10)
except sqlite3.IntegrityError: raise AssertionError('custom row retry failed')
assert snapshot(db)==([('a',90),('b',10)],[('three','a','b',10)])
`;
export const cases=[
 {id:'p01',candidate:baseline.replace('            db.rollback()\n            return','            db.execute(\'UPDATE accounts SET balance = balance - ? WHERE id = ?\', (amount, source))\n            db.execute(\'UPDATE accounts SET balance = balance + ? WHERE id = ?\', (amount, destination))\n            db.commit()\n            return'),defects:[{id:'duplicate-transfer',severity:null,description:'Repeated request mutates balances twice'}],failureLabel:'retry mutated balances'},
 {id:'p02',candidate:baseline.replace("db.execute('BEGIN')","db.execute('BEGIN IMMEDIATE')"),defects:[]},
 {id:'p03',candidate:baseline.replace('    except Exception:\n        db.rollback()','    except Exception:\n        db.commit()'),defects:[{id:'partial-commit',severity:null,description:'Failed operation commits balances and receipt'}],failureLabel:'failed transfer persisted'},
 {id:'p04',candidate:baseline.replace('receipt is not None','receipt != None'),defects:[{id:'row-factory-retry',severity:null,description:'Overloaded equality hides an existing receipt and breaks idempotent retry'}],failureLabel:'custom row retry failed'},
 {id:'p05',candidate:baseline.replaceAll('receipt =','prior_receipt =').replaceAll('if receipt','if prior_receipt'),defects:[]}
];
