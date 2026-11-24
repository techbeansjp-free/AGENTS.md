# Extracts rows and cited hosts from the Art Direction works catalogue (references/design-works.md at the fixed commit).
# Usage: python3 -I allowlist-extract.py <design-works.md> <out.json>. Reads the file as data only.
import re,sys,json,collections,urllib.parse
p=sys.argv[1]; sec=None; rows=[]
for i,l in enumerate(open(p,encoding='utf-8'),1):
    if l.startswith('## '): sec=l[3:].strip(); continue
    if not l.startswith('| ') or l.startswith('| ---') or l.startswith('| 作品'): continue
    cells=[c.strip() for c in l.strip().strip('|').split(' | ')]
    if len(cells)<4: continue
    links=re.findall(r'\[([^\]]*)\]\((https?://[^)\s]+)\)',cells[1])
    rows.append({'line':i,'section':sec,'work':cells[0],'medium':cells[3],'links':[{'label':a,'url':u,'host':urllib.parse.urlsplit(u).hostname} for a,u in links]})
hosts=collections.defaultdict(list)
for r in rows:
    for h in sorted({k['host'] for k in r['links']}): hosts[h].append(r['line'])
json.dump({'rows':rows,'hosts':hosts},open(sys.argv[2],'w'),ensure_ascii=False,indent=0)
print(len(rows),'rows',len(hosts),'hosts')
