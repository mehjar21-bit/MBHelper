import json
from pathlib import Path

p1 = Path(r"c:/Users/maxim/Downloads/card_cache (70).json")
p2 = Path(r"c:/Users/maxim/Downloads/card_cache (71).json")

if not p1.exists() or not p2.exists():
    print('Missing file:', p1.exists(), p2.exists())
    raise SystemExit(1)

A = json.load(p1.open('r', encoding='utf-8'))
B = json.load(p2.open('r', encoding='utf-8'))

ka = [k for k in A.keys() if k.startswith('owners_')]
kb = [k for k in B.keys() if k.startswith('owners_')]

set_a = set(ka)
set_b = set(kb)

inter = sorted(set_a & set_b)
only_a = sorted(set_a - set_b)
only_b = sorted(set_b - set_a)

print('count_a', len(set_a))
print('count_b', len(set_b))
print('common', len(inter))
print('\nFirst 200 common keys:')
for k in inter[:200]:
    print(k)

print('\nFirst 200 only in a:')
for k in only_a[:200]:
    print(k)

print('\nFirst 200 only in b:')
for k in only_b[:200]:
    print(k)
