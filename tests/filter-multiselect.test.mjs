import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const html=fs.readFileSync(new URL('../review-appeal-dashboard.html',import.meta.url),'utf8');
function fn(name){const tail=html.slice(html.indexOf(`function ${name}(`));return tail.slice(0,tail.indexOf('\n')).trimEnd().endsWith('}')?tail.slice(0,tail.indexOf('\n')):tail.slice(0,tail.indexOf('\n}')+2);}
function context(extra={}){const ctx=vm.createContext(extra);for(const name of ['matchesSelection','filterRows','filterRowsMulti','selectedValues','sum','sumKnown','ratio','knownRate','productSummaryForFilter','ownerRowsForFilter','updateMultiSelectSummary','bindApplyFilters'])vm.runInContext(fn(name),ctx);return ctx;}
const objects=rows=>rows.slice(1).map(row=>Object.fromEntries(rows[0].map((key,i)=>[key,row[i]])));
const records=[
 {link:'a',product:'A',owner:'甲',reviewDate:'2026-10-12',appealDate:'2026-10-13',status:'已删除'},
 {link:'b',product:'B',owner:'甲',reviewDate:'2026-10-12',appealDate:'2026-10-13',status:'已提交'},
 {link:'c',product:'A',owner:'乙',reviewDate:'2026-10-19',appealDate:'2026-10-20',secondStatus:'已删除'},
 {link:'d',product:'B',owner:'乙',reviewDate:'2026-10-19',appealDate:'',secondStatus:'已删除'},
];
function build(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-multi-'));try{const env={...process.env};for(const [key,file] of Object.entries({REVIEW_RECORDS_PATH:'records.json',REVIEW_DATA_PATH:'data.json',REVIEW_SALES_PATH:'sales.json',REVIEW_CHECKS_PATH:'checks.json',REVIEW_VERIFIED_PATH:'verified.json'}))env[key]=path.join(dir,file);fs.writeFileSync(env.REVIEW_RECORDS_PATH,JSON.stringify(records));execFileSync(process.execPath,[fileURLToPath(new URL('../update_frontend_report.mjs',import.meta.url))],{env});return JSON.parse(fs.readFileSync(env.REVIEW_DATA_PATH));}finally{fs.rmSync(dir,{recursive:true,force:true});}}
const data=build();
test('all ten filters use the common multi-select with select-all and clear actions',()=>{
 const uses=[...html.matchAll(/multiSelectHtml\('([^']+)'/g)].map(m=>m[1]);
 assert.deepEqual(uses,['overviewWeekFilter','productWeekFilter','productProductFilter','appealWeekFilter','appealProductFilter','reviewWeekFilter','reviewProductFilter','ownerWeekFilter','ownerProductFilter','ownerFilter']);
 assert.doesNotMatch(html,/\boptionsFor\(/);
 assert.match(fn('multiSelectHtml'),/multiple/);assert.match(fn('multiSelectHtml'),/SelectAll/);assert.match(fn('multiSelectHtml'),/Clear/);
 for(const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
});
test('selecting, select-all and clearing only apply on the filter button click',()=>{
 const elements={};const element=id=>elements[id]??=( {id,dataset:{},textContent:'',listeners:{},addEventListener(event,cb){this.listeners[event]=cb;}} );
 const select=element('filter');select.multiple=true;select.options=['W38','W39','W40'].map(value=>({value,selected:false}));Object.defineProperty(select,'selectedOptions',{get(){return this.options.filter(x=>x.selected);}});
 ['filterSummary','filterSelectAll','filterClear','apply'].forEach(element);let renders=0;
 const ctx=context({document:{getElementById:element}});ctx.bindApplyFilters('apply',['filter'],()=>renders++);
 select.options[0].selected=select.options[1].selected=true;select.listeners.change();assert.equal(renders,0);assert.equal(element('filterSummary').textContent,'已选 2/3 项');element('apply').listeners.click();assert.equal(renders,1);
 element('filterSelectAll').listeners.click();assert.equal(select.selectedOptions.length,3);assert.equal(renders,1);element('apply').listeners.click();assert.equal(renders,2);
 element('filterClear').listeners.click();assert.equal(select.selectedOptions.length,0);assert.equal(renders,2);element('apply').listeners.click();assert.equal(renders,3);
});
test('cleared product weeks and explicit all weeks have identical weekly totals',()=>{
 const rows=objects(data.product_review_week);const ctx=context({productWeek:rows,productSummary:objects(data.product_summary)});
 const all=ctx.productSummaryForFilter([],[]),explicit=ctx.productSummaryForFilter([...new Set(rows.map(r=>r.周次))],[]);
 assert.equal(JSON.stringify(all),JSON.stringify(explicit));assert.equal(all.reduce((n,r)=>n+r.所选留评周申诉数,0),3);assert.equal(all.reduce((n,r)=>n+r.所选留评周删除数,0),2);
});
test('owner product multi-select counts only matching products, including undated second deletions',()=>{
 const ctx=context({ownerWeek:objects(data.owner_week),ownerProductWeek:objects(data.owner_product_week),allProducts:['A','B']});
 const a=ctx.ownerRowsForFilter([],['A'],['甲','乙']);assert.equal(a.reduce((n,r)=>n+r.申诉数量,0),2);assert.equal(a.reduce((n,r)=>n+r.已删除数量,0),2);assert.ok(a.every(r=>r.负责产品==='A'));
 const b=ctx.ownerRowsForFilter([],['B'],['乙']);assert.equal(b.length,1);assert.equal(b[0].周次,'申诉周未填写');assert.equal(b[0].已删除数量,1);
 assert.equal(JSON.stringify(ctx.ownerRowsForFilter([],[],[])),JSON.stringify(ctx.ownerRowsForFilter([],['A','B'],[])));
 for(const original of objects(data.owner_week)){const split=objects(data.owner_product_week).filter(r=>r.周次===original.周次&&r.负责人===original.负责人);for(const field of ['申诉数量','已删除数量','状态空白数','待跟进数'])assert.equal(split.reduce((n,r)=>n+r[field],0),original[field]);}
});
test('week and product filters support independent multi-selection and unlimited clearing',()=>{
 const ctx=context();const rows=[{周次:'W38',产品:'A'},{周次:'W39',产品:'B'},{周次:'W40',产品:'C'}];
 assert.equal(ctx.filterRows(rows,['W38','W39'],['A','B']).length,2);assert.equal(ctx.filterRows(rows,[],['A','C']).length,2);assert.equal(ctx.filterRows(rows,[],[]).length,3);
});

test('overview starts on default week, applies another week, and supports cumulative all weeks',()=>{
 const rows=objects(data.product_review_week),weeks=[...new Set(rows.map(r=>r.周次))];
 const elements={},element=id=>elements[id]??={innerHTML:'',dataset:{},listeners:{},addEventListener(event,cb){this.listeners[event]=cb;}};
 let rendered;
 const ctx=context({DATA:{...data,meta:{...data.meta,defaultWeek:weeks[0]}},latestWeek:weeks.at(-1),productWeeks:weeks,productWeek:rows,productSummary:objects(data.product_summary),document:{getElementById:element},esc:String,fmtNum:String,excludedProductNote:()=>'',applyFiltersButtonHtml:()=>'',table:(values,cols)=>{rendered={values,cols};return 'table';},multiSelectHtml:(id,label,values,chosen)=>{const select=element(id);select.multiple=true;select.options=values.map(value=>({value,selected:chosen.includes(value)}));Object.defineProperty(select,'selectedOptions',{get(){return this.options.filter(o=>o.selected);}});return '清空选择（显示全部）';}});
 for(const name of ['totalProductSummaryRow','renderOverview'])vm.runInContext(fn(name),ctx);
 ctx.renderOverview();
 const select=element('overviewWeekFilter'),total=()=>rendered.values.at(-1);
 assert.deepEqual(select.selectedOptions.map(o=>o.value),[weeks[0]]);
 assert.equal(total().本周新增差评,2);assert.equal(total().所选留评周申诉数,2);assert.equal(total().所选留评周删除数,1);
 const cumulative=total().累计删除数量;
 select.options.forEach(o=>o.selected=o.value===weeks[1]);select.listeners.change();
 assert.equal(total().所选留评周申诉数,2,'changing selection must not apply before button');
 element('overviewApplyFilters').listeners.click();
 assert.equal(total().所选留评周申诉数,1);assert.equal(total().累计删除数量,cumulative);
 assert.ok(element('overviewWeekContext').innerHTML.includes(weeks[1]));
 element('overviewWeekFilterClear').listeners.click();element('overviewApplyFilters').listeners.click();
 assert.equal(total().本周新增差评,4);assert.equal(total().所选留评周申诉数,3);assert.equal(total().所选留评周删除数,2);
 assert.equal(total().累计删除数量,cumulative);assert.match(element('overviewWeekContext').innerHTML,/累计所有周/);
 assert.ok(rendered.cols.some(c=>c.label==='全部留评周销量'));
 element('overviewWeekFilterSelectAll').listeners.click();element('overviewApplyFilters').listeners.click();assert.equal(total().所选留评周申诉数,3);
});
