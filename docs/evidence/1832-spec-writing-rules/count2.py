import re,sys
t=open(sys.argv[1]).read()
body=re.sub(r"```.*?```","",t,flags=re.S)
prose="\n".join(l for l in body.split("\n") if not l.lstrip().startswith("|"))
cells=[c.strip() for l in body.split("\n") if l.lstrip().startswith("|") and not l.startswith("|---") for c in l.strip("|").split("|")]
sents=[s.strip(" -*0123456789.") for s in re.split(r"[。\n]",prose) if len(s.strip(" -*#"))>3 and not s.strip().startswith("#")]
print(f"chars {len(body)} prose_sents {len(sents)} prose_avg {sum(map(len,sents))/len(sents):.1f} cells {len(cells)} cell_avg {sum(map(len,cells))/max(1,len(cells)):.1f}")
