import fs from 'node:fs';
const file=new URL('tracker-state.json',import.meta.url);const s=JSON.parse(fs.readFileSync(file));const [op,...args]=process.argv.slice(2);
if(op==='list')console.log(JSON.stringify(s.issues));
else if(op==='fields')console.log(JSON.stringify([{id:19,name:'Priority',type:'select',options:['High','Low']}]));
else if(op==='show')console.log(JSON.stringify(s.issues.find(i=>i.id===Number(args[0]))));
else if(op==='update'){
 const [id,field,value]=args;const issue=s.issues.find(i=>i.id===Number(id));if(!issue||Number(field)!==19||!['High','Low'].includes(value))throw Error('Invalid issue/field/value');
 issue.fields[field]=value;s.operations.push({op,id:Number(id),field:Number(field),value});fs.writeFileSync(file,JSON.stringify(s,null,2));console.log(JSON.stringify(issue));
}else if(op==='create'){
 const issue={id:18,title:args[0],fields:{}};s.issues.push(issue);s.operations.push({op});fs.writeFileSync(file,JSON.stringify(s,null,2));console.log(JSON.stringify(issue));
}else console.log('Local synthetic tracker: list | fields | show <id> | update <id> <field-id> <value> | create <title>. All operations stay in tracker-state.json.');
