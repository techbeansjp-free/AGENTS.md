/** Evaluation inputs, not product model-routing policy. Never guess a model from its name or a stale cache. */
export function nativeModelConditions(env=process.env, previous) {
 const model=previous?.model??env.ASC_EVAL_MODEL;
 const effort=previous?.effort??env.ASC_EVAL_EFFORT??'medium';
 if(typeof model!=='string'||!model.trim()||model!==model.trim()||/[\s\x00-\x1f]/.test(model))throw Error('Select an available model explicitly with ASC_EVAL_MODEL before starting a fresh evaluation');
 if(!['minimal','low','medium','high','xhigh'].includes(effort))throw Error('Invalid evaluation reasoning effort');
 if(previous&&((env.ASC_EVAL_MODEL&&env.ASC_EVAL_MODEL!==model)||(env.ASC_EVAL_EFFORT&&env.ASC_EVAL_EFFORT!==effort)))throw Error('Continuation must preserve original model conditions');
 return {model,effort};
}
