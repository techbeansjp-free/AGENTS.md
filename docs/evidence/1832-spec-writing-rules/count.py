import re,sys
t=open(sys.argv[1]).read()
body=re.sub(r"```.*?```","",t,flags=re.S)
sents=[s.strip() for s in re.split(r"[。\n]",body) if len(s.strip())>3 and not s.strip().startswith(("|---","#"))]
hist_pat=r"変更前|今回の変更|今回から|追加した|延ばした|変えた|変更した|以前は|これまで|打合せ|決定者|前は|前から|従来"
hist=[s for s in sents if re.search(hist_pat,s)]
print("chars",len(body),"sentences",len(sents),"avg",round(sum(map(len,sents))/len(sents),1),"history",len(hist))
for h in hist: print("  H:",h[:80])
