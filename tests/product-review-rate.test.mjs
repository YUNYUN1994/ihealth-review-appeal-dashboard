import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../review-appeal-dashboard.html',import.meta.url),'utf8');
function fn(name){const tail=html.slice(html.indexOf('function '+name+'('));return tail.slice(0,tail.indexOf('\n'));}
const ctx=vm.createContext({});for(const name of ['esc','fmtPct','fmtNum','sum','sumKnown','ratio','productReviewRate','withProductReviewRate','productReviewRateFormula','totalProductWeekRow','totalCard'])vm.runInContext(fn(name),ctx);
const row=(sales,reviews)=>({'当周销量':sales,'当周新增差评':reviews,'当周提交差评数':reviews,'当周删除数':0});
test('selected week sales produce rate and fraction for rows and total',()=>{
 const rows=[row(1046,6),row(989,6),row(467,11),row(77,1)];const total=ctx.totalProductWeekRow(rows,'W42');
 assert.equal(ctx.fmtPct(total.当周差评率),'0.93%');assert.equal(ctx.productReviewRateFormula(total),'24 / 2,579');
 assert.equal(ctx.fmtPct(ctx.withProductReviewRate(rows[2]).当周差评率),'2.36%');assert.equal(ctx.productReviewRateFormula(ctx.withProductReviewRate(rows[2])),'11 / 467');
 assert.equal(rows[0].当周差评率,undefined,'must not mutate source data');
});
test('multiple products and weeks use weighted totals instead of average percentages',()=>{
 const total=ctx.totalProductWeekRow([row(100,10),row(900,9)]);assert.equal(total.当周差评率,0.019);assert.equal(ctx.productReviewRateFormula(total),'19 / 1,000');
});
test('unknown or zero sales are excluded from both fraction and rate, without losing reviews',()=>{
 const rows=[row(100,2),row(null,8),row(0,3),row('',1),row(undefined,4)];const total=ctx.totalProductWeekRow(rows);
 assert.equal(total.当周新增差评,18);assert.equal(total.当周差评率,0.02);assert.equal(total.差评率部分覆盖,true);assert.equal(ctx.productReviewRateFormula(total),'2 / 100');
 for(const r of rows.slice(1)){const value=ctx.withProductReviewRate(r);assert.equal(value.当周差评率,null);assert.equal(ctx.productReviewRateFormula(value),'销量缺失或为 0');}
});
test('no reviews with valid sales yields zero percent; no valid sales yields a dash',()=>{
 assert.equal(ctx.fmtPct(ctx.withProductReviewRate(row(100,0)).当周差评率),'0.00%');
 for(const rows of [[],[row(null,5)],[row(0,5)]]){const total=ctx.totalProductWeekRow(rows);assert.equal(ctx.fmtPct(total.当周差评率),'-');assert.doesNotMatch(ctx.productReviewRateFormula(total),/NaN|Infinity/);}
});
test('rate is sortable as a number with a separate fraction display and summary card detail',()=>{
 assert.match(html,/{key:'当周差评率',label:'差评率',type:'pct',num:true,rateDetail:true}/);assert.match(html,/map\(withProductReviewRate\)/);
 const rendered=ctx.totalCard('合计',[['差评率','0.93%',false,'24 / 2,579']]);assert.match(rendered,/total-detail.*24 \/ 2,579/);
 for(const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
});
