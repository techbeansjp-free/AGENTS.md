#!/bin/sh
# Runs one generated suite with `claude plugin eval` (isolated temporary HOME/config per run, read-only tools),
# copies every run's trace out of the kept sandbox, then deletes the kept sandboxes.
# Usage: run-suite.sh <suites-root> <suite: A|B|C|F|diag|iso> <out-dir> <max-cost-usd>
set -u
root=$1 suite=$2 out=$3 cap=$4
mkdir -p "$out/traces"
cd "$root" || exit 1
claude plugin eval . --eval-dir "evals-$suite" --ablation none --no-publish --trust-plugin --scaffold --keep-temp \
  --disallow-tools Task Agent TaskStop -j 4 --max-cost-usd "$cap" \
  --json "$out/$suite.json" --output-dir "$out/$suite-report" > "$out/$suite.stdout" 2> "$out/$suite.stderr"
echo "exit=$?" > "$out/$suite.exit"
node -e '
const fs=require("fs"),path=require("path");const [res,dir]=process.argv.slice(1);const j=JSON.parse(fs.readFileSync(res,"utf8"));
for(const c of j.cases)c.arms.with.forEach((r,i)=>{const dst=path.join(dir,`${c.name}-${i+1}.jsonl`);try{fs.copyFileSync(r.tracePath,dst)}catch(e){fs.writeFileSync(dst+".missing",String(e))}});
' "$out/$suite.json" "$out/traces"
for k in $(grep -o "kept /private/tmp/e-[A-Za-z0-9]*" "$out/$suite.stderr" | cut -d" " -f2 | sort -u); do
  chmod 700 "$k" "$k/sealed" 2>/dev/null; chmod -R u+rwx "$k" 2>/dev/null; rm -rf "$k"
done
