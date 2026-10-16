/** Synthetic private evaluation data, never installed as project policy. */
export const intent='Refactor the internal total calculation without changing its contract. Unit price is a nonnegative integer, quantity a positive integer (booleans are invalid). Result must be an integer no greater than 9007199254740991. Invalid arguments or an excessive product raise ValueError. No external effects.';
export const baseline=`MAX = 9007199254740991

def total(price, quantity):
    if type(price) is not int or type(quantity) is not int or price < 0 or quantity <= 0:
        raise ValueError('invalid input')
    result = price * quantity
    if result > MAX:
        raise ValueError('overflow')
    return result
`;
const helper=`MAX = 9007199254740991

def validate(price, quantity):
    if type(price) is not int or type(quantity) is not int or price < 0 or quantity <= 0:
        raise ValueError('invalid input')
    if price * quantity > MAX:
        raise ValueError('overflow')
`;
export const cases=[
 {id:'r01',candidate:baseline.replace("    if result > MAX:\n        raise ValueError('overflow')\n",''),defects:[{id:'overflow',severity:null,oracle:"total(9007199254740991, 2)",description:'Oversized product returned instead of ValueError'}]},
 {id:'r02',candidate:helper+`\ndef total(price, quantity):\n    validate(price, quantity)\n    return price * quantity\n`,defects:[]},
 {id:'r03',candidate:baseline.replace('quantity <= 0','quantity < 0'),defects:[{id:'zero-quantity',severity:null,oracle:'total(10, 0)',description:'Zero quantity accepted contrary to positive-only contract'}]},
 {id:'r04',candidate:baseline.replace('    result = price * quantity',"    if quantity == 1 and price <= MAX:\n        return price\n    result = price * quantity"),defects:[]}
];
export const oracle=`from calc import total
assert total(125, 3) == 375
assert total(0, 1) == 0
assert total(9007199254740991, 1) == 9007199254740991
for args in [(-1,1),(1,0),(1,-1),(1,1.5),(True,1),(1,True),(9007199254740991,2),(9007199254740992,1)]:
    try: total(*args)
    except ValueError: pass
    else: raise AssertionError('invalid accepted: '+repr(args))
`;
