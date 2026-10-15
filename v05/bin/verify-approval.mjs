#!/usr/bin/env node
// stdin is provided by the trusted controller, never an Agent tool invocation.
import fs from 'node:fs';
import {verifyApproval} from '../src/approval.mjs';
try {
  const data=fs.readFileSync(0);
  if (data.length>65536) throw Error('Approval input limit exceeded');
  const input=JSON.parse(data);
  console.log(JSON.stringify(verifyApproval(input.envelope,input.binding,input.trustedKeys)));
} catch (e) { console.error(e.message);process.exitCode=1; }
