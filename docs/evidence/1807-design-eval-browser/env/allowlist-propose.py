# Builds env/allowlist.proposed.json from the extract (selection rules are in the output "selection").
# Usage: python3 -I allowlist-propose.py <extract.json> <design-works.md> <out.json>
import json,sys,re,hashlib
d=json.load(open(sys.argv[1])); src=sys.argv[2]; out=sys.argv[3]
rows={r['line']:r for r in d['rows']}
W='作品（画面・サイト）そのもの'; C='制作者（スタジオ・設計者）の公式サイト'; O='発注者・運営者の公式サイト（作品の掲載元）'
sel=[  # host, lines, role
('www.britishmuseum.org',[18],O),('www.webusability.co.uk',[18],C),('www.andreabrown.co',[20],C),('www.clarityhk.com',[25],C),
('coosy.co.jp',[27],C),('loftwork.com',[34],C),('s-modern.com',[42],C),('www.wfs.games',[68],C),('www.imhds.co.jp',[72],O),
('tusitala.sg',[79],C),('cappen.com',[80],C),('www.riomarrecife.com.br',[80],W),('www.cstone.co.kr',[84],C),('naviplus.dgbt.jp',[88],C),
('www.takashimaya.co.jp',[94],W),('www.1-10.com',[102],C),('yakai.1-10.com',[102],W),('mount.jp',[104,121,127,128,141,170,172],C),
('www.kai-group.com',[104],O),('www.cinra.co.jp',[108],C),('www.shashin-kagaku.co.jp',[109],C),('linear.app',[110],W),
('nmwa.org',[111],W),('www.purplerockscissors.com',[111],C),('www.pentagram.com',[112],C),('madebyfieldwork.com',[114],C),
('area17.com',[115],C),('archive.area17.com',[115],C),('design.google',[116],C),('goodpatch.com',[117,173],C),('huntersvillage.jp',[117],W),
('baigie.me',[118],C),('keitatakemura.com',[119],C),('www.perfectdays-movie.jp',[121],W),('www.sprocket.bz',[129],C),
('www.matthuynh.com',[130],C),('www.sbs.com.au',[130],W),('toyota.jp',[141],W),('linx.jp',[142],W),('www.smoothandfriendly.com',[142],C),
('sevendex.com',[150],W),('www.nintendo.co.jp',[151],O),('p5r.jp',[152],W),('www.jp.square-enix.com',[153],O),('captown.capcom.com',[154],W),
('appirits.com',[154],C),('kyoto.studio-uni.com',[165],C),('www.ndc.co.jp',[168],C),('www.daimaru-matsuzakaya.com',[170],O),('aniary.com',[172],W),
('service.hhms.co.jp',[177],C),('toyooka-theaterfestival.jp',[188],W),('relier-inc.co.jp',[194],C),('games.parco.jp',[195],W),
('www.jred.co.jp',[204],C),('accessability.rgd.ca',[206],O),('www.gk-kyoto.com',[207],C),('www.lta.gov.sg',[208],O),
('mutlaqstudio.com',[241],C),('zyda.com',[241],W),('www.drindesigns.com',[252],C),('wondr.io',[253],C),('www.nendo.jp',[255],C),
('about.tsuzuku.tokyo',[128],W),('boutiquestar.jp',[181],C),('flamegame.studio',[63],C),('haajapan.com',[125],W),('recruit-note.kai-group.com',[104],O),
('tipomap.lat',[250],C),('website.hankyu-dept.co.jp',[177],W),('www.dotzero.jp',[191],C),('www.elpalaciodehierro.com',[250],O),('www.keihan.co.jp',[124],O),
('www.shop.keihan-dept.co.jp',[124],W),('www.kirin1.com',[171],C),('www.master-apps.jp',[118],O),('www.nintendo.com',[151],O),('www.w2solution.co.jp',[146],C),
('www.westjr.co.jp',[171],O),('benesse-artsite.jp',[275,276],O)]
ent=[]
for h,ls,role in sel:
    for l in ls:
        r=rows[l]; assert h in {k['host'] for k in r['links']}, (h,l)
    med=sorted({rows[l]['medium'].split('；')[1] for l in ls})
    ent.append({'host':h,'role':role,'source':[{'file':'references/design-works.md','line':l,'section':rows[l]['section']} for l in ls],
      'medium':med,'linkCount':sum(1 for l in ls for k in rows[l]['links'] if k['host']==h),
      'reason':f"Art Directionの作品案内が、画面・案内の作品（{'・'.join(med)}）の公開資料として挙げる{role}。業務画面・検索一覧・モバイルの見本として閲覧の対象になり得る"})
# exclusion census over the whole catalogue
cats={'動画配信（画面の静止画で確認できず、外部scriptが多い）':['www.youtube.com','vimeo.com','player.vimeo.com'],
 '投稿・資料共有の場（作品・制作者の公式ではない）':['note.com','speakerdeck.com','www.behance.net'],
 '報道・告知配信・業界誌（第三者の記事）':['prtimes.jp','prtimes.com','cgworld.jp','www.4gamer.net','www.famitsu.com','news.mynavi.jp','www.theguardian.com','news.cision.com'],
 '賞・データベース・集約（第三者の登録）':['ifdesign.com','www.i-award.or.kr','segd.org','award.kidp.or.kr','www.designdb.com','www.commarts.com','www.uisdc.com','cedec-kyushu.jp'],
 '汎用のfile配信・大規模サービス':['storage.googleapis.com','artsandculture.google.com','blog.google','www.uniqlo.com'],
 '第三者の紹介記事・公募の場（教育機関・ツール提供者・公募）':['www.lasalle.edu.sg','www.unrealengine.com','totsukuru.jp'],
 '媒体が印刷物（年の欄の「案内」で抽出された行）':['nationalartsfestival.co.za','assets.nationalartsfestival.co.za']}
selhosts={e['host'] for e in ent}
screen=[r for r in d['rows'] if re.search(r'Web|アプリ|操作|案内',r['medium'])]
screenHosts=sorted({k['host'] for r in screen for k in r['links']})
excluded=[{'category':c,'hosts':[h for h in hs if h in d['hosts']]} for c,hs in cats.items()]
other=[h for h in screenHosts if h not in selhosts and not any(h in e['hosts'] for e in excluded)]
doc={'schema':'asc-1807-allowlist-proposal/v1','status':'proposal: owner review pending (not applied to env/allowlist.json)',
 'basis':{'skill':'anything-frontend-art-direction','commit':'046e42c7de149373993109cf4a211a577b1c3bcc','file':'references/design-works.md',
   'fileSha256':hashlib.sha256(open(src,'rb').read()).hexdigest(),'rowsTotal':len(d['rows']),'hostsTotal':len(d['hosts'])},
 'selection':['作品案内の行のうち、「地域・媒体・年」の欄に「Web」「アプリ」「操作」「案内」を含む行（画面・情報設計の作品）を対象にする（'+str(len(screen))+'行、'+str(len(screenHosts))+' host）',
   'その行の公開資料のリンク先hostのうち、作品そのもの、制作者、または発注者・運営者の公式サイトだけを選ぶ',
   '動画配信・投稿の場・報道や告知配信・賞やデータベース・汎用のfile配信は除く（下のexcluded）',
   'hostは完全一致だけ（subdomainの一括許可はしない）。portは443だけ。転送先も同じ規則で検査し、外れたら遮断する'],
 'hosts':ent,'excluded':excluded,'excludedOtherScreenHosts':other,
 'hostsOnlyInOtherRows':len(d['hosts'])-len(selhosts)-sum(len(e['hosts']) for e in excluded)-len(other)}
json.dump(doc,open(out,'w'),ensure_ascii=False,indent=1)
print(len(ent),'hosts selected; other screen hosts not selected:',other)
