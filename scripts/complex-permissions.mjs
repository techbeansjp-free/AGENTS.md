/** Add explicit synthetic-fixture access without changing the base sandbox policy. */
export function extendFixturePermissions(options, reads, writes) {
  const indexes=options.flatMap((value,index)=>value.startsWith('permissions.')&&value.includes('.filesystem=')?[index]:[]);
  if(indexes.length!==1)throw Error('Expected exactly one filesystem permission option');
  const index=indexes[0],original=options[index];
  if(!original.endsWith(' }'))throw Error('Unsupported filesystem permission table format');
  const entries=[...reads.map(root=>[root,'read']),...writes.map(root=>[root,'write'])];
  if(entries.length===0)throw Error('Fixture permissions must be explicit');
  options[index]=original.slice(0,-2)+entries.map(([root,access])=>`, ${JSON.stringify(root)}=${JSON.stringify(access)}`).join('')+' }';
}
