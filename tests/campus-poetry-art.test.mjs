import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMPUS_POETRY,paintCampusMural} from '../src/campus-poetry-art.js';

// The copy is user-authored, including the unusual wording in heroes. This
// independent fixture prevents editorial "corrections" or automatic uppercasing.
const expected=[
  ['life-ai','给AI以生命，而不是给生命以AI'],
  ['life-art','生活源于艺术而高于艺术'],
  ['responsibility','能力越大，责任越大'],
  ['chocolate',"life is always like a box of chocolate, you'll never know what you are gonna get"],
  ['birds','some birds are never meant to be caged, their feathers are just too bright'],
  ['possibility','你能做的，岂止如此！'],
  ['heroes','侠骨柔情的英雄气概\n重心然诺的君子风度\n快意恩仇的人生境界\n照亮了我们平庸而琐碎的生活'],
  ['breeze','他强任他强，清风拂山岗，\n他横由他横，明月照大江。'],
  ['day','seize the day'],
  ['stay','S.T.A.Y'],
];

// Record the real painter's text commands rather than duplicating its layout.
// A deliberately broad measurement provider exercises its measurement-based
// fitting. This validates canvas layout bounds, not OS font rasterisation;
// browser visual QA remains necessary for actual font fallback and antialiasing.
function recordingContext(width,height,advanceScale=1){
  const text=[],operations=[],stack=[];
  const ctx={font:'10px serif',textAlign:'start',textBaseline:'alphabetic',globalAlpha:1,
    measureText(value){
      const size=Number(this.font.match(/([\d.]+)px/)?.[1]||10);
      const advance=[...value].reduce((sum,c)=>sum+(/\s/.test(c)?.35:/[\u0000-\u007f]/.test(c)?.64:1.05),0)*size*advanceScale;
      return {width:advance,actualBoundingBoxAscent:size*.52,actualBoundingBoxDescent:size*.52};
    },
    fillText(value,x,y,maxWidth){
      const m=this.measureText(value),left=x-(this.textAlign==='center'?m.width/2:this.textAlign==='right'?m.width:0);
      text.push({value,font:this.font,alpha:this.globalAlpha,maxWidth,left,right:left+m.width,top:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent});
    },
    clearRect(...args){operations.push(['clearRect',...args]);},
    fillRect(...args){operations.push(['fillRect',...args]);},
    save(){stack.push({font:this.font,textAlign:this.textAlign,textBaseline:this.textBaseline,globalAlpha:this.globalAlpha});},
    restore(){Object.assign(this,stack.pop());},
  };
  for(const name of ['scale','beginPath','moveTo','lineTo','bezierCurveTo','stroke','strokeRect','strokeText','arc','ellipse','fill'])ctx[name]=(...args)=>operations.push([name,...args]);
  return {ctx,text,operations,width,height};
}

test('all ten authored poems preserve exact wording, punctuation and letter case',()=>{
  assert.deepEqual(CAMPUS_POETRY.map(p=>[p.id,p.text]),expected);
  assert.equal(new Set(CAMPUS_POETRY.map(p=>p.id)).size,10);
  assert.ok(Object.isFrozen(CAMPUS_POETRY));
  for(const poem of CAMPUS_POETRY){
    assert.ok(Object.isFrozen(poem)&&Object.isFrozen(poem.lines));
    assert.equal(poem.lines.join('').replace(/\s/g,''),poem.text.replace(/\s/g,''),'composition may wrap text but cannot delete or substitute characters');
  }
});

test('the actual Canvas painter emits every authored character within its artwork bounds',()=>{
  for(const poem of CAMPUS_POETRY)for(const metricScale of [1,1.25]){
    const width=poem.vertical?512:1024,height=768,record=recordingContext(width,height,metricScale);
    paintCampusMural(record.ctx,{width,height},{...poem,poetryId:poem.id,color:'#69736b'});
    const drawn=record.text.map(t=>t.value).join('');
    assert.equal(drawn.replace(/\s/g,''),poem.text.replace(/\s/g,''),`${poem.id}: no ellipsis, abbreviation, forced uppercase or lost glyph`);
    assert.deepEqual(record.text.map(t=>t.value),poem.vertical||poem.motif==='orbit'?[...poem.lines.join('')]:poem.lines,'each painter command keeps interior spaces and punctuation, not just the non-space characters');
    for(const t of record.text){
      assert.equal(t.maxWidth,undefined,'text is fitted by font metrics rather than squeezed by fillText maxWidth');
      assert.equal(t.alpha,1,'motif translucency cannot accidentally make the text itself faint');
      assert.ok(t.left>=0&&t.right<=width&&t.top>=0&&t.bottom<=height,`${poem.id}: clipped text ${JSON.stringify(t)}`);
    }
    assert.ok(record.text.length>0);
    assert.equal(record.operations[0][0],'clearRect');
    assert.ok(!record.operations.some(op=>op[0]==='fillRect'),'artwork has no opaque billboard background');
  }
});

test('vertical couplet and spaced S.T.A.Y use their intended reading order',()=>{
  for(const id of ['breeze','stay']){
    const poem=CAMPUS_POETRY.find(p=>p.id===id),record=recordingContext(768,768);
    paintCampusMural(record.ctx,{width:768,height:768},{...poem,poetryId:id,color:'#69736b'});
    assert.deepEqual(record.text.map(t=>t.value),[...poem.lines.join('')]);
    if(id==='breeze'){
      const first=record.text.slice(0,[...poem.lines[0]].length),second=record.text.slice(first.length);
      assert.ok(first.every((t,i)=>!i||t.top>first[i-1].top),'first column reads down');
      assert.ok(second[0].left<first[0].left,'second column follows to the left');
    }else assert.ok(record.text.every((t,i)=>!i||t.left>record.text[i-1].right),'S.T.A.Y has separated letters without altering case');
  }
});
