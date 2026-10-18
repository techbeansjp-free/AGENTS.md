import http from 'node:http';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.env.DATA_FILE||'users.sqlite');
db.exec('CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, version INTEGER NOT NULL DEFAULT 1)');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const send=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url==='/'&&req.method==='GET'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(fs.readFileSync(new URL('./page.html',import.meta.url)));return;}
  const role={'dummy-admin':'admin','dummy-reader':'reader'}[req.headers['x-fixture-session']];
  if(!role)fail(401,'ログインが必要です');
  const url=new URL(req.url,'http://fixture');
  if(req.method==='GET'&&url.pathname==='/api/users'){
   const page=Number(url.searchParams.get('page')||1);if(!Number.isSafeInteger(page)||page<1)fail(400,'ページ番号が不正です');
   const total=db.prepare('SELECT count(*) AS n FROM users').get().n;
   const actual=Math.min(page,Math.max(1,Math.ceil(total/2)));
   send(res,200,{page:actual,total,users:db.prepare('SELECT * FROM users ORDER BY id LIMIT 2 OFFSET ?').all((actual-1)*2)});return;
  }
  if(role!=='admin')fail(403,'変更する権限がありません');
  const match=/^\/api\/users\/([1-9][0-9]*)$/.exec(url.pathname);
  const id=match?Number(match[1]):null;
  if(match&&!Number.isSafeInteger(id))fail(400,'IDが不正です');
  if(req.method==='DELETE'&&match){const r=db.prepare('DELETE FROM users WHERE id=?').run(id);if(!r.changes)fail(404,'対象が見つかりません');send(res,200,{deleted:true});return;}
  if(!((req.method==='POST'&&url.pathname==='/api/users')||(req.method==='PUT'&&match)))fail(404,'対象が見つかりません');
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)fail(413,'入力が大きすぎます');}
  let body;try{body=JSON.parse(raw);}catch{fail(400,'入力形式が不正です');}
  const fields=req.method==='POST'?['name','email']:['name','email','version'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields.includes(k)))fail(400,'入力項目が不正です');
  if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>80)fail(400,'名前は1〜80文字です');
  if(typeof body.email!=='string'||body.email.length>254||!/^[^\s@]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(body.email.trim()))fail(400,'メールアドレスが不正です');
  const name=body.name.trim(),email=body.email.trim().toLowerCase();
  if(req.method==='POST'){const r=db.prepare('INSERT INTO users(name,email) VALUES(?,?)').run(name,email);send(res,201,{id:r.lastInsertRowid});return;}
  if(!Number.isSafeInteger(body.version)||body.version<1)fail(400,'versionが不正です');
  if(!db.prepare('SELECT id FROM users WHERE id=?').get(id))fail(404,'対象が見つかりません');
  const r=db.prepare('UPDATE users SET name=?,email=?,version=version+1 WHERE id=? AND version=?').run(name,email,id,body.version);
  if(!r.changes)fail(409,'他の操作で更新されています。一覧を再読込みしてください');send(res,200,{updated:true});
 }catch(e){send(res,e.status??(/UNIQUE constraint/.test(e.message)?409:500),{error:e.status?e.message:/UNIQUE constraint/.test(e.message)?'メールアドレスは登録済みです':'保存できませんでした'});}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));
