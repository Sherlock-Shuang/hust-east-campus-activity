import { WORLD } from './layout.js';

/** Procedural architectural reconstruction. All geometry/textures authored locally.
 * Source-observed identity: five-storey A–D comb plan, curved glazed east bridge,
 * open double-height round-column arcade, pale tiled walls and an east-side lake.
 * The metric layout and furnishings are an interpretation, not a measured survey.
 */
export function createCampus(THREE, scene) {
  const campusGroup = new THREE.Group(); campusGroup.name='东九教学楼 · 程序化复原'; scene.add(campusGroup);
  const classroomGroup = new THREE.Group(); classroomGroup.name='A101 教室'; classroomGroup.visible=false; scene.add(classroomGroup);
  const batches=new Map(), dummy=new THREE.Object3D(), tempColor=new THREE.Color();
  let seed=942011;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
  const unitBox=new THREE.BoxGeometry(1,1,1), unitCylinder=new THREE.CylinderGeometry(1,1,1,10), unitSphere=new THREE.IcosahedronGeometry(1,2);
  function material(color,roughness=.8,metalness=0){return new THREE.MeshStandardMaterial({color,roughness,metalness});}
  function texturedMaterial(color,kind){
    const mat=material(color,kind==='water'?.23:.88);
    mat.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec3 vCampusWorld;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>\nvec4 campusP = vec4(transformed,1.);\n#ifdef USE_INSTANCING\ncampusP=instanceMatrix*campusP;\n#endif\nvCampusWorld=(modelMatrix*campusP).xyz;`);
      shader.fragmentShader='varying vec3 vCampusWorld;\nfloat campusHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n'+shader.fragmentShader;
      const snippets={
        wall:`vec2 grid = abs(fract(vec2(vCampusWorld.x+vCampusWorld.z,vCampusWorld.y)*5.)-.5); float grout=step(.475,max(grid.x,grid.y)); float n=campusHash(floor(vCampusWorld.xz*14.+vCampusWorld.y*21.)); diffuseColor.rgb*=.97+.055*n-.065*grout;`,
        stone:`vec2 tile=fract(vCampusWorld.xz/1.15);float grout=step(.973,max(tile.x,tile.y));float n=campusHash(floor(vCampusWorld.xz*35.));diffuseColor.rgb*=.92+.13*n-.14*grout;`,
        asphalt:`float n=campusHash(floor(vCampusWorld.xz*53.));diffuseColor.rgb*=.88+.22*n;`,
        grass:`float n=campusHash(floor(vCampusWorld.xz*11.));float broad=sin(vCampusWorld.x*.48)*sin(vCampusWorld.z*.33);diffuseColor.rgb*=.86+.16*n+.045*broad;`,
        wood:`float n=sin(vCampusWorld.z*85.+sin(vCampusWorld.x*12.)*2.);diffuseColor.rgb*=.91+.055*n;`,
      };
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n'+(snippets[kind]||''));
    };mat.customProgramCacheKey=()=>kind;return mat;
  }
  const M={wall:texturedMaterial('#deded1','wall'),trim:material('#f0eee4'),roof:material('#b7b9ae'),glass:material('#719397',.24,.35),glassDark:material('#45676d',.26,.3),frame:material('#c5cfca',.45,.45),stone:texturedMaterial('#c9c6b7','stone'),curb:material('#dedac9'),asphalt:texturedMaterial('#666c68','asphalt'),grass:texturedMaterial('#8e9c62','grass'),soil:material('#9b8d6c'),dark:material('#303f3b'),metal:material('#52635c',.44,.7),yellow:material('#d6b75c'),white:material('#eee9d6'),wood:texturedMaterial('#9d7450','wood'),bark:material('#6c624d'),water:material('#6e9c9b',.22,.28),leaf:material('#496338'),hedge:material('#526e3e'),purple:material('#6b4551')};
  const geometryIds=new WeakMap(),materialIds=new WeakMap();let nextG=0,nextM=0;
  function batch(geometry,mat,x,y,z,sx,sy,sz,rot=0,color=null,group=campusGroup){
    if(!geometryIds.has(geometry))geometryIds.set(geometry,++nextG);if(!materialIds.has(mat))materialIds.set(mat,++nextM);
    const key=`${group.id}/${geometryIds.get(geometry)}/${materialIds.get(mat)}`;
    if(!batches.has(key))batches.set(key,{geometry,mat,group,items:[]});
    batches.get(key).items.push({x,y,z,sx,sy,sz,rot,color});
  }
  function box(mat,x,y,z,w,h,d,rot=0,color=null,group=campusGroup){batch(unitBox,mat,x,y,z,w,h,d,rot,color,group)}
  function cyl(mat,x,y,z,r,h,group=campusGroup){batch(unitCylinder,mat,x,y,z,r,h,r,0,null,group)}
  function ball(mat,x,y,z,sx,sy,sz,color=null){batch(unitSphere,mat,x,y,z,sx,sy,sz,0,color)}
  function line(mat,a,b,r=.04,group=campusGroup){
    const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),mid=av.clone().add(bv).multiplyScalar(.5),len=av.distanceTo(bv);
    const quaternion=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),bv.sub(av).normalize());batch(unitCylinder,mat,mid.x,mid.y,mid.z,r,len,r,quaternion,null,group);
  }
  function textLabel(text,x,y,z,w,h,{bg='#e8e8dc',fg='#334c45',rot=0,size=80,group=campusGroup,font='600'}={}){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=Math.max(128,Math.round(1024*h/w));const c=canvas.getContext('2d');
    c.fillStyle=bg;c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle=fg;c.font=`${font} ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(text,512,canvas.height/2,970);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map:texture,roughness:.8,side:THREE.DoubleSide}));mesh.position.set(x,y,z);mesh.rotation.y=rot;group.add(mesh);return mesh;
  }
  function groundStrip(a,b,width,mat=M.stone,y=.035){const dx=b.x-a.x,dz=b.z-a.z;box(mat,(a.x+b.x)/2,y,(a.z+b.z)/2,width,.08,Math.hypot(dx,dz),Math.atan2(dx,dz));}
  // Broad landscape, two aligned campus streets, paved pedestrian network.
  box(M.grass,350,-.24,-70,1900,.45,1400);
  for(const r of WORLD.roads){
    const rot=r.rot||0,c=Math.cos(rot),sn=Math.sin(rot);box(M.asphalt,r.x,.015,r.z,r.w,.07,r.d+1,rot);
    for(const side of[-1,1]){const off=side*(r.w/2+.17);box(M.curb,r.x+c*off,.12,r.z-sn*off,.32,.24,r.d,rot);const walk=side*(r.w/2+1.7);box(M.stone,r.x+c*walk,.04,r.z-sn*walk,2.8,.1,r.d,rot);}
    for(let dz=-r.d/2+3;dz<r.d/2;dz+=8)box(M.yellow,r.x+sn*dz,.066,r.z+c*dz,.12,.012,3.6,rot);
  }
  // Paved forecourt follows the recessed concave façade, with generous open space.
  box(M.stone,23,.035,0,67,.08,133);
  box(M.stone,24,.035,101,86,.08,33);
  for(const b of WORLD.buildings)box(M.stone,b.x,.03,b.z,b.w+6,.09,b.d+6);
  const pathSeen=new Set();for(const a of WORLD.pathNodes)for(const id of a.links){const key=[a.id,id].sort().join('/');if(pathSeen.has(key))continue;pathSeen.add(key);const b=WORLD.pathNodes.find(n=>n.id===id);const steps=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/1.5);for(let i=0;i<steps;i++){const p={x:a.x+(b.x-a.x)*i/steps,z:a.z+(b.z-a.z)*i/steps},q={x:a.x+(b.x-a.x)*(i+1)/steps,z:a.z+(b.z-a.z)*(i+1)/steps};const cx=(p.x+q.x)/2,cz=(p.z+q.z)/2;if(!WORLD.roads.some(r=>{const c=Math.cos(r.rot||0),s=Math.sin(r.rot||0),dx=cx-r.x,dz=cz-r.z;return Math.abs(c*dx-s*dz)<r.w/2+.3&&Math.abs(s*dx+c*dz)<r.d/2+.3;}))groundStrip(p,q,3.7);}}
  // Zebra markings at the canteen merge and classroom entrance; walkers share the rush.
  for(const node of [WORLD.pathNodes.find(n=>n.id==='canteenMerge'),WORLD.pathNodes.find(n=>n.id==='aTurn')])for(let k=-5;k<=5;k++)box(M.white,node.x+k*1.2,.075,node.z, .6,.015,5,-.122);
  // Individual tiled slabs, recessed blue-gray windows, mullions and roof parapets.
  const floor=4.15, top=21.3;
  for(const [i,b] of WORLD.buildings.filter(b=>!b.kind).entries()){
    const min=b.x-b.w/2,max=b.x+b.w/2;
    box(M.wall,b.x,top/2,b.z,b.w,top,b.d);
    for(let level=0;level<5;level++){
      const y=1.8+floor*level;
      for(const side of [-1,1]){
        box(M.glassDark,b.x,y+.15,b.z+side*(b.d/2+.017),b.w-.9,2.5,.045);
        // Solid piers alternate with generous classroom ribbon-window bays.
        for(let x=min+1.7;x<max-.6;x+=3.25){
          box(M.glass,x,y+.15,b.z+side*(b.d/2+.047),2.66,2.38,.05,0,rand()<.15?'#6e8583':null);
          box(M.frame,x,y-.17,b.z+side*(b.d/2+.09),2.72,.07,.07);
          for(const off of [-1.34,0,1.34])box(M.frame,x+off,y+.15,b.z+side*(b.d/2+.1),.065,2.5,.09);
          box(M.wall,x+1.59,y+.15,b.z+side*(b.d/2+.11),.35,2.55,.24);
        }
        box(M.trim,b.x,level*floor+.55,b.z+side*(b.d/2+.16),b.w+.4,.5,.38);
        box(M.trim,b.x,level*floor+3.45,b.z+side*(b.d/2+.13),b.w+.3,.23,.3);
      }
      // Window stacks on east and west gable, broken by stairwell walls.
      for(const end of [min-.035,max+.035])for(const dz of [-4.7,0,4.7]){box(M.glassDark,end,y+.2,b.z+dz,.07,2.45,2.75);box(M.frame,end+(end>0?.04:-.04),y+.2,b.z+dz,.09,2.5,.09);}
    }
    box(M.roof,b.x,top+.05,b.z,b.w+.7,.23,b.d+.7);
    for(const side of [-1,1])box(M.trim,b.x,top+.6,b.z+side*(b.d/2+.13),b.w+.6,1.1,.3);
    for(const end of [min,max])box(M.trim,end,top+.6,b.z,.3,1.1,b.d);
    // Roof access and quiet mechanical details give the roof a plausible silhouette.
    box(M.wall,min+14,top+1.45,b.z,7.2,2.6,5.3);box(M.roof,min+14,top+2.8,b.z,7.6,.18,5.7);
    for(let x=min+28;x<max-7;x+=19){box(M.metal,x,top+.55,b.z-2.5,2.4,.7,1.8);for(let k=0;k<5;k++)box(M.frame,x-.85+k*.43,top+.94,b.z-2.5,.12,.1,1.6);}
    // Distinct gold A / B / C / D letters on outward eastern face.
    textLabel('ABCD'[i],max+.1,18.5,b.z,3.1,3.8,{rot:Math.PI/2,bg:'#dfded3',fg:'#ad8b3f',size:350});
    // Stairwell bay at west end: continuous glazing with floor treads visible.
    box(M.glassDark,min+7,10.7,b.z+b.d/2+.2,5,18,.2);
    for(let y=2;y<20;y+=1.65){box(M.trim,min+7,y,b.z+b.d/2+.36,4.9,.22,.25);box(M.frame,min+7,y+.78,b.z+b.d/2+.38,.08,1.6,.1);}
  }
  // The residential route is east/northeast of East9. The road topology and
  // endpoint displacement come from official navigation; block footprints are indicative.
  const dormWall=texturedMaterial('#c2bda5','wall'),dormAccent=material('#9e6956'),canteenWall=material('#c6b79a');
  for(const b of WORLD.surroundings){
    const levels=b.floors,height=levels*3.25,mat=b.kind==='canteen'?canteenWall:dormWall;
    box(mat,b.x,height/2,b.z,b.w,height,b.d);box(M.roof,b.x,height+.1,b.z,b.w+.5,.3,b.d+.6);
    for(const side of[-1,1]){
      for(let l=0;l<levels;l++){
        const y=1.65+l*3.25;
        for(let x=b.x-b.w/2+2;x<b.x+b.w/2-1;x+=3.5){
          box(M.glassDark,x,y,b.z+side*(b.d/2+.04),2.25,1.85,.08);
          box(M.frame,x,y,b.z+side*(b.d/2+.1),.065,1.9,.09);
          box(M.frame,x,y-.28,b.z+side*(b.d/2+.1),2.3,.065,.08);
          if(b.kind==='dorm'&&l>0){box(M.trim,x,y-.97,b.z+side*(b.d/2+.35),2.75,.16,.7);box(M.metal,x,y-.65,b.z+side*(b.d/2+.65),2.65,.045,.045);}
        }
        box(dormAccent,b.x,y-1.28,b.z+side*(b.d/2+.12),b.w,.18,.24);
      }
    }
    box(M.wall,b.x-b.w/2+3,height+.7,b.z,4.4,1.3,b.d-3);
    const label=b.label.includes('23')?'韵苑 23 栋':b.kind==='canteen'?'韵苑学生食堂':'韵苑公寓';
    textLabel(label,b.x,Math.min(height-1.6,6.9),b.z+b.d/2+.2,Math.min(b.w-4,18),1.7,{bg:b.kind==='canteen'?'#315548':'#b8af97',fg:'#f5edd7',size:100});
    if(b.kind==='canteen'){box(M.glassDark,b.x+b.w/2+.08,2.7,b.z,.13,4.2,b.d-7);textLabel('韵苑学生食堂',b.x+b.w/2+.2,7.2,b.z,19,2.0,{rot:Math.PI/2,bg:'#315548',fg:'#f5edd7',size:90});box(M.trim,b.x+b.w/2+2,5.1,b.z,4.5,.25,b.d-5);}
  }
  // A continuous bespoke curved surface; its bands follow the same mathematical arc.
  function curvedRibbon(y0,y1,offset,mat,thickness=.24){
    const positions=[],normals=[],uv=[],idx=[],steps=96;
    for(let i=0;i<=steps;i++){const z=-75+150*i/steps,x=WORLD.arcX(z)+offset;const n=new THREE.Vector3(1,0,-.0084*z).normalize();for(const y of [y0,y1]){positions.push(x,y,z);normals.push(n.x,0,n.z);uv.push(i/steps,y/22);}}
    for(let i=0;i<steps;i++){let a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);
    const mesh=new THREE.Mesh(g,mat);mesh.castShadow=true;mesh.receiveShadow=true;campusGroup.add(mesh);return mesh;
  }
  // The bridge is genuinely elevated: its underside is open and columns are round.
  const bridgeSteps=60;for(let i=0;i<bridgeSteps;i++){let z=-75+(i+.5)*150/bridgeSteps,x=WORLD.arcX(z),rot=Math.atan(.0084*z),len=150/bridgeSteps*Math.sqrt(1+(.0084*z)**2)+.08;box(M.wall,x-2,14.2,z,8,12.4,len,rot);box(M.trim,x+1.2,8.05,z,9.2,.5,len,rot);box(M.roof,x-1.9,20.65,z,9,.25,len,rot);}
  for(let j=0;j<3;j++){
    curvedRibbon(8.55+j*4.15,11.35+j*4.15,2.75,M.glassDark);
    curvedRibbon(8.6+j*4.15,11.3+j*4.15,2.78,M.glass);
    curvedRibbon(11.4+j*4.15,12.65+j*4.15,2.85,M.wall);
    curvedRibbon(8.35+j*4.15,8.6+j*4.15,2.9,M.trim);
    curvedRibbon(9.8+j*4.15,9.88+j*4.15,2.88,M.frame);
    for(let z=-73;z<=73;z+=1.55){const x=WORLD.arcX(z),rot=Math.atan(.0084*z);box(M.frame,x+2.93,9.95+j*4.15,z,.11,2.75,.075,rot);}
  }
  curvedRibbon(20.8,21.75,2.85,M.trim);
  for(let z=-68;z<=68;z+=10.5){const x=WORLD.arcX(z);cyl(M.wall,x+1.2,4,z,.7,8);cyl(M.trim,x+1.2,.22,z,.83,.44);cyl(M.wall,x-5.0,4,z,.55,8);}
  // Region letters are mounted to the bridge fascia, facing the lake.
  for(const [z,label]of[[-45,'B'],[38,'C']])textLabel(label,WORLD.arcX(z)+2.5,7.55,z,2.7,1.8,{rot:Math.PI/2,bg:'#ddddd0',fg:'#b28b3c',size:420});
  // North-facing A entrance is the verified endpoint of the 23栋 commute.
  box(M.glassDark,35,2.45,-83.13,7.8,4.7,.18);box(M.metal,35,2.45,-83.26,.1,4.7,.11);
  for(const x of[31.1,38.9])box(M.frame,x,2.45,-83.26,.12,4.7,.12);
  box(M.frame,35,4.9,-83.28,8,.12,.14);box(M.trim,35,5.5,-85,10,.27,4.5);
  for(const x of[30.3,39.7])cyl(M.metal,x,2.75,-86.3,.09,5.5);
  for(let i=0;i<3;i++)box(M.stone,35,.06+i*.04,-84.2-i*.45,9,.12,.6);
  textLabel('东九教学楼   A 区',35,5.02,-83.42,8.1,.75,{rot:Math.PI,bg:'#394d49',fg:'#eee9d5',size:80});
  textLabel('A101  高等数学',40.6,2.2,-83.2,2.1,.65,{rot:Math.PI,bg:'#e5dfc3',fg:'#38443e',size:80});
  // Gold building name on the front of the D block, visible from the approach.
  textLabel('逸 夫 教 学 楼',11,19.1,83.3,22,2.05,{bg:'#deded1',fg:'#a78a48',size:83});
  // Front garden beds, low hedges and formal paving inlays, grounded in aerial imagery.
  for(const z of [-48,-20,20,48]){
    box(M.soil,46,.12,z,11,.2,15);box(M.hedge,46,.55,z,10.5,.9,14.5);
    box(M.grass,46,1.02,z,8.3,.05,12.3);
    for(let k=0;k<4;k++){const angle=k*Math.PI/2;ball(k%2?M.purple:M.hedge,46+Math.cos(angle)*2.6,1.45,z+Math.sin(angle)*4,1.8,.85,1.7);}
  }
  for(let z=-55;z<=55;z+=8)box(M.dark,26,.087,z,32,.012,.24);
  // Lake basin: irregularly oval edge, low stone coping, translucent wave highlights.
  const lakeShape=new THREE.Shape();const points=[];
  for(let i=0;i<=100;i++){const a=i/100*Math.PI*2;let rx=WORLD.lake.rx*(1+.025*Math.sin(a*3));let x=WORLD.lake.x+Math.cos(a)*rx,z=WORLD.lake.z+Math.sin(a)*WORLD.lake.rz;points.push(new THREE.Vector3(x,.1,z));if(i===0)lakeShape.moveTo(x,-z);else lakeShape.lineTo(x,-z);}
  const lakeMesh=new THREE.Mesh(new THREE.ShapeGeometry(lakeShape,80),M.water);lakeMesh.rotation.x=-Math.PI/2;lakeMesh.position.y=.115;lakeMesh.receiveShadow=true;campusGroup.add(lakeMesh);
  const lakeCurve=new THREE.CatmullRomCurve3(points,true);const coping=new THREE.Mesh(new THREE.TubeGeometry(lakeCurve,140,.3,7,true),M.curb);coping.position.y=.1;campusGroup.add(coping);
  const waveMaterial=new THREE.MeshBasicMaterial({color:'#c4d4bd',transparent:true,opacity:.16,depthWrite:false});
  const waves=[];for(let i=0;i<26;i++){const z=(rand()-.5)*68,x=75+(rand()-.5)*36;const mesh=new THREE.Mesh(new THREE.PlaneGeometry(3+rand()*8,.05+rand()*.12),waveMaterial);mesh.rotation.x=-Math.PI/2;mesh.position.set(x,.129,z);campusGroup.add(mesh);waves.push(mesh);}
  // Perimeter lake walk keeps all navigation nodes outside the water.
  const bankPath=[];for(let i=0;i<=80;i++){const a=i/80*Math.PI*2;bankPath.push({x:75+Math.cos(a)*33,z:Math.sin(a)*47});}for(let i=1;i<bankPath.length;i++)groundStrip(bankPath[i-1],bankPath[i],2.8,M.stone,.045);
  // Alpha-cut sprays carry individual local leaf silhouettes, breaking up crown edges.
  const leafCanvas=document.createElement('canvas');leafCanvas.width=256;leafCanvas.height=256;const lc=leafCanvas.getContext('2d');
  for(let i=0;i<43;i++){const a=rand()*Math.PI*2,r=Math.sqrt(rand())*105,x=128+Math.cos(a)*r,y=128+Math.sin(a)*r;lc.save();lc.translate(x,y);lc.rotate(rand()*6.28);lc.fillStyle=['#789652','#95ad68','#567d3f','#6b8e49'][i%4];lc.beginPath();lc.ellipse(0,0,9+rand()*8,4+rand()*4,0,0,Math.PI*2);lc.fill();lc.restore();}
  const leafTexture=new THREE.CanvasTexture(leafCanvas);leafTexture.colorSpace=THREE.SRGBColorSpace;leafTexture.anisotropy=4;
  const sprayMat=new THREE.MeshStandardMaterial({map:leafTexture,color:'#a9be91',alphaTest:.4,side:THREE.DoubleSide,roughness:1});const leafPlane=new THREE.PlaneGeometry(1,1);
  // Bespoke tree crowns are made from irregular overlapping leaf masses, with branching trunks.
  function tree(x,z,scale=1){
    const h=(8+rand()*3)*scale,trunk=h*.62,spread=(3.0+rand()*1.3)*scale;
    cyl(M.bark,x,trunk/2,z,.22*scale,trunk);
    for(let k=0;k<3;k++){const a=rand()*Math.PI*2;line(M.bark,[x,trunk*.6,z],[x+Math.cos(a)*spread*.45,trunk+scale,z+Math.sin(a)*spread*.45],.11*scale);}
    for(let k=0;k<8;k++){let a=k*2.3999,r=spread*Math.sqrt((k+.5)/8)*.48;ball(M.leaf,x+Math.cos(a)*r,h*.72+rand()*h*.21,z+Math.sin(a)*r,spread*.18,spread*.23,spread*.18,['#bac796','#ced5aa','#92b278','#b4c78c'][k%4]);}
    for(let k=0;k<170;k++){const az=rand()*Math.PI*2,vy=rand()*2-1,rr=Math.sqrt(1-vy*vy),rad=spread*(.35+rand()*.65);const dx=Math.cos(az)*rr,dz=Math.sin(az)*rr;const normal=new THREE.Vector3(dx,vy*.7,dz).normalize(),q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),normal);batch(leafPlane,sprayMat,x+dx*rad,h*.82+vy*spread*.78,z+dz*rad,2.25*scale,2.25*scale,1,q,null);}
    cyl(M.trim,x,.48,z,.225*scale,.75); // whitewash on mature campus trunks
  }
  // Dense but nonuniform avenues and green western campus perimeter.
  for(let z=-107;z<240;z+=13){tree(145+rand()*3,z+rand()*3,.95);if(z>120)tree(111.5+rand(),z,.76);}
  for(let x=-125;x<108;x+=14){tree(x,161+rand()*3,.8+rand()*.15);if(x<53)tree(x,127+rand()*3,.85);}
  for(let z=-107;z<115;z+=13){tree(-123+rand()*4,z,.95);}
  for(let x=-95;x<118;x+=13)tree(x,-108+rand()*3,.95);
  for(let i=0;i<44;i++){let x=-87+rand()*82,z=-62+Math.floor(i/15)*50+rand()*15;if(z<63)tree(x,z,.62+rand()*.2);}
  for(let i=0;i<19;i++){const a=rand()*Math.PI*2,x=75+Math.cos(a)*(39+rand()*8),z=Math.sin(a)*(55+rand()*8);if(x>42&&z<68)tree(x,z,.65+rand()*.25);}
  for(let z=183;z<246;z+=16)for(let x=-70;x<95;x+=23)tree(x+rand()*5,z+rand()*4,.85);
  for(let x=-210;x<230;x+=16)tree(x+rand()*6,-145-rand()*25,1.1+rand()*.2);
  for(let z=-130;z<250;z+=20){tree(181+rand()*15,z,1.1);tree(-163-rand()*12,z,1.1);}
  for(const r of WORLD.roads){const rot=r.rot||0,c=Math.cos(rot),sn=Math.sin(rot);for(let dz=-r.d/2+9;dz<r.d/2-5;dz+=16)for(const side of[-1,1]){const off=side*(r.w/2+5.7),tx=r.x+sn*dz+c*off,tz=r.z+c*dz-sn*off;if(!WORLD.buildings.some(b=>Math.abs(tx-b.x)<b.w/2+3&&Math.abs(tz-b.z)<b.d/2+3))tree(tx,tz,.9+rand()*.16);}}
  // Broad green strip west of the dormitory road, as visible on the campus map.
  for(let z=-350;z<-220;z+=18)for(const x of[492,513])tree(x+rand()*6,z,.92);
  // Site furniture: readable direction signs, benches, litter bins and lighting.
  function lamp(x,z){cyl(M.metal,x,3.2,z,.08,6.4);line(M.metal,[x,6.3,z],[x+.8,6.45,z],.07);box(M.dark,x+.8,6.39,z,.85,.14,.38);box(M.white,x+.8,6.30,z,.7,.035,.3);}
  for(const r of WORLD.roads){const rot=r.rot||0,c=Math.cos(rot),sn=Math.sin(rot);for(let dz=-r.d/2+15;dz<r.d/2;dz+=35)lamp(r.x+sn*dz+c*(r.w/2+3),r.z+c*dz-sn*(r.w/2+3));}
  function bench(x,z,rot=0){for(let j=0;j<4;j++)box(M.wood,x,.48,z+(j-1.5)*.12,2.1,.075,.105,rot);box(M.wood,x,.85,z-.29,2.1,.35,.09,rot);for(const dx of [-.8,.8]){box(M.metal,x+dx,.23,z,.09,.45,.48,rot);}}
  for(const z of [-52,0,52]){bench(38,z);bench(110,z);box(M.metal,111,.6,z+2.7,.48,1.15,.5);box(M.dark,111,1.18,z+2.7,.5,.1,.53);}
  cyl(M.metal,270,1.8,-100,.07,3.6);textLabel('东九教学楼  →',270,3.2,-100.05,5,.9,{rot:Math.PI/2,bg:'#35594f',fg:'#f1eddc',size:84});textLabel('喻园大道',270,2.12,-100.05,5,.65,{rot:Math.PI/2,bg:'#35594f',fg:'#f1eddc',size:85});
  textLabel('东九湖',79,.8,49,2.5,.8,{bg:'#a6a18b',fg:'#3b4a3f',size:130});
  // Everyday campus electric scooters: low battery body, step-through deck, seat,
  // steering cowl, disk wheels, mirrors and grips. Geometry is instanced in world space.
  const wheelGeo=new THREE.TorusGeometry(.255,.055,7,18),diskGeo=new THREE.CylinderGeometry(.19,.19,.085,14);
  const scooterPaint=[material('#d4d1bd',.4,.1),material('#788a8c',.4,.1),material('#a86551',.4,.1),material('#474f51',.4,.1)];
  function scooter(x,z,index=0,rot=0){
    const paint=scooterPaint[index%scooterPaint.length],yawQ=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),rot);
    function part(g,m,px,py,pz,sx,sy,sz,extraQ=null){const v=new THREE.Vector3(px,py,pz).applyQuaternion(yawQ),q=yawQ.clone();if(extraQ)q.multiply(extraQ);batch(g,m,x+v.x,py,z+v.z,sx,sy,sz,q,null);}
    const roll=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2),wheelTurn=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2);
    for(const wz of [-.62,.62]){part(wheelGeo,M.dark,0,.31,wz,1,1,1,wheelTurn);part(diskGeo,M.metal,0,.31,wz,1,1,1,roll);}
    part(unitBox,paint,0,.46,-.34,.48,.36,.69);part(unitBox,M.dark,0,.36,.09,.48,.09,.96);
    part(unitBox,M.dark,0,.73,-.35,.47,.13,.68);part(unitBox,paint,0,.58,.61,.36,.63,.25);
    part(unitBox,M.metal,0,.93,.58,.065,.53,.065);part(unitBox,paint,0,1.14,.57,.41,.23,.23);
    part(unitBox,M.white,0,1.15,.702,.24,.105,.025);part(unitBox,M.dark,0,1.22,.55,.76,.055,.07);
    for(const dx of [-.31,.31]){part(unitBox,M.metal,dx,1.37,.53,.025,.3,.025);part(unitSphere,M.dark,dx,1.53,.53,.075,.06,.035);}
    part(unitBox,M.dark,0,.89,-.65,.45,.26,.07);part(unitBox,M.yellow,0,.51,-.701,.2,.06,.02);
  }
  for(let i=0;i<40;i++)scooter(-30+i*1.45,98,i,-.23);
  for(let i=0;i<22;i++)scooter(53,-97+i*1.25,i,1.45);
  for(let row=0;row<7;row++)for(let i=0;i<30;i++)scooter(8+row*2.8,-60+i*4.0,i+row,Math.PI/2);
  for(let i=0;i<36;i++)scooter(674+i*1.5,-263,i,.12);
  // Far-side elevated transit viaduct as a secondary landmark, simplified in distance.
  box(M.roof,-126,9.2,-4,7.5,1.1,235);
  for(let z=-110;z<110;z+=21)cyl(M.wall,-126,4.4,z,.9,8.8);
  for(const side of [-1,1]){box(M.glassDark,-126+side*3.5,11,-4,.13,2.8,235);for(let z=-118;z<112;z+=4.1)box(M.frame,-126+side*3.5,11,z,.14,3,.1);}
  // Classroom is a fully authored interior kept hidden until the player enters.
  const C=classroomGroup;
  box(M.stone,400,-.08,-.5,14.3,.18,19.5,0,null,C);
  box(M.wall,392.9,2.1,-.5,.2,4.2,19.5,0,null,C);box(M.wall,407.1,2.1,-.5,.2,4.2,19.5,0,null,C);
  box(M.wall,400,2.1,-10.1,14.4,4.2,.2,0,null,C);box(M.wall,400,2.1,9.1,14.4,4.2,.2,0,null,C);
  box(M.trim,400,4.25,-.5,14.4,.18,19.5,0,null,C);
  // Eastern windows; translucent sky panes and thin aluminum muntins.
  const windowMat=material('#b6d1d1',.4);windowMat.emissive=new THREE.Color('#799999');windowMat.emissiveIntensity=.25;
  for(let z=-7;z<7;z+=3.3){box(windowMat,406.97,2.45,z,.08,2.5,2.8,0,null,C);for(const dz of [-1.4,0,1.4])box(M.frame,406.90,2.45,z+dz,.1,2.5,.045,0,null,C);box(M.frame,406.91,2.4,z,.1,.04,2.8,0,null,C);box(M.trim,406.8,1.15,z,.35,.12,3.0,0,null,C);}
  box(M.wood,400,.14,-8.2,10,.28,2.4,0,null,C);box(M.dark,400,2.12,-9.91,10,2.2,.08,0,null,C);
  textLabel('高等数学  /  第一讲\n',400,2.65,-9.85,9.7,.7,{bg:'#24483e',fg:'#ecebd5',size:78,group:C});
  textLabel('lim   sin x / x = 1       ∫ f(x) dx = F(x) + C',400,1.87,-9.84,9.7,.8,{bg:'#24483e',fg:'#dbdfc8',size:68,group:C,font:'400'});
  box(M.frame,400,.96,-9.78,10.2,.08,.26,0,null,C);
  box(M.wood,400,.65,-7.55,2.2,1.0,.85,0,null,C);box(M.dark,400,1.2,-7.55,2.3,.1,1,0,null,C);
  // Eight rows, two banks, a central aisle kept clear for the player.
  for(let row=0;row<7;row++)for(const side of [-1,1])for(let col=0;col<3;col++){
    const x=400+side*(1.7+col*1.48),z=-5.1+row*1.55;
    box(M.wood,x,.79,z,1.34,.07,.64,0,null,C);box(M.metal,x,.39,z,.95,.75,.37,0,null,C);
    box(M.wood,x,.45,z+.68,1.1,.08,.4,0,null,C);box(M.wood,x,.82,z+.91,1.1,.6,.07,0,null,C);
    for(const dx of [-.43,.43])box(M.metal,x+dx,.22,z+.68,.06,.43,.4,0,null,C);
    if((row+col)%4===0){box(M.white,x-.2,.845,z, .31,.025,.4,.08,null,C);box(M.dark,x+.35,.85,z+.1,.13,.04,.21,0,null,C);}
  }
  textLabel('A101',400,3.3,8.96,2,.6,{bg:'#e3ddc5',fg:'#4b564d',size:150,rot:Math.PI,group:C});
  for(let z=-6;z<8;z+=4.2)for(const x of [396,404]){box(M.frame,x,4.08,z,1.3,.13,.28,0,null,C);box(M.white,x,3.99,z,1.2,.035,.2,0,null,C);}
  const roomFill=new THREE.HemisphereLight('#f5f6ed','#9c9f84',1.6);C.add(roomFill);
  // Batch repeated surfaces into a handful of draw calls. Individual props stay articulated.
  for(const {geometry,mat,group,items}of batches.values()){
    const mesh=new THREE.InstancedMesh(geometry,mat,items.length);mesh.castShadow=mat!==M.grass&&mat!==M.asphalt;mesh.receiveShadow=true;
    for(let i=0;i<items.length;i++){const b=items[i];dummy.position.set(b.x,b.y,b.z);if(typeof b.rot==='number')dummy.rotation.set(0,b.rot,0);else dummy.quaternion.copy(b.rot);dummy.scale.set(b.sx,b.sy,b.sz);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);if(b.color!==null)mesh.setColorAt(i,new THREE.Color(b.color));else mesh.setColorAt(i,new THREE.Color('#ffffff'));}
    mesh.instanceMatrix.needsUpdate=true;group.add(mesh);
  }
  return {
    campusGroup,classroomGroup,lakeMesh,
    update(time,dt,weather){for(let i=0;i<waves.length;i++){waves[i].position.x+=Math.sin(time*.24+i)*dt*.025;waves[i].material.opacity=weather==='rain'?.10:.16;}},
    dispose(){for(const group of[campusGroup,classroomGroup]){group.traverse(obj=>{if(obj.geometry)obj.geometry.dispose();if(obj.material){for(const m of Array.isArray(obj.material)?obj.material:[obj.material]){m.map?.dispose();m.dispose();}}});scene.remove(group);}},
  };
}
