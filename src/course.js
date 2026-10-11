// Course mode: every step becomes a lesson (Learn, Watch, Do, Check). The lesson text comes
// from the roadmap; this file adds the end-of-phase quizzes and optional lesson videos.
// Videos are configured by the site owner in DATA_DIR/course-media.json: {"<step slug>":"https://...mp4 or YouTube URL"}.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

const Q=(q,options,answer,why)=>({q,options,answer,why});

export const QUIZZES={
  1:[Q('Why write rules as observable behavior?',['They sound more professional','Each one becomes something you can test and check off','Unreal requires it'],1,'A testable rule turns into a checklist item you can verify.'),
     Q('What should the first mission include?',['The whole world','One area, one weapon, one enemy type, one objective and an exit','Every feature you want'],1,'A complete small loop gets finished; a big one stalls.'),
     Q('What do you record for every asset?',['Only its name','Make, buy or generate, its source and its license','Its file size'],1,'Licenses decide what you can legally ship.'),
     Q('When must you decide on multiplayer?',['At release','Now, at the start','After the vertical slice'],1,'Multiplayer changes how every system and save works.')],
  2:[Q('What does version control give you?',['Faster rendering','A history of every change so you can undo mistakes','Free assets'],1,'You can roll back any broken change.'),
     Q('Why check the Auto Setup plugin before upgrading Unreal?',['It may not support the new version yet','It costs money','It deletes projects'],0,'Tools must support the engine version you use.'),
     Q('What does the MCP plugin do?',['Plays music','Lets AI agents operate the Unreal editor with your approval','Compresses textures'],1,'It is how agents place assets and run tools.'),
     Q('Epic\'s recommended graphics memory for its open-world City Sample is…',['2 GB','8 GB','64 GB'],1,'8 GB VRAM is the minimum Duke checks for.')],
  3:[Q('What is a blockout?',['A finished level','A level made of plain boxes to test sizes and routes','A loading screen'],1,'Changing boxes is cheap; changing art is not.'),
     Q('Why package a build early?',['It is required by Steam','Working in the editor does not prove the packaged game works','It makes the game prettier'],1,'Packaging problems are cheapest to fix early.'),
     Q('Who decides when an attack hits?',['The animation','The code','The camera'],1,'The animation is only the picture.'),
     Q('During a playtest you should…',['Explain the controls','Stay silent and take notes','Play for them'],1,'Their confusion is the data.')],
  4:[Q('How many photos does Headshot 3 need at minimum?',['One front photo','Twenty','A 3D scan'],0,'One works; more angles improve likeness.'),
     Q('What does DeLight do?',['Brightens the scene','Removes the photo\'s lighting from the skin texture','Deletes lights'],1,'Skin must react to game lights, not the photo\'s.'),
     Q('What are skin weights?',['How heavy a character is','Which bones move which parts of the mesh','Texture sizes'],1,'Bad weights cause stretching and clipping.'),
     Q('Why do CC5 and MetaHuman sharing a skeleton matter?',['Animations move between them without retargeting','It saves disk space','It is required for Steam'],0,'Shared skeletons reuse animation.')],
  5:[Q('When should World Partition be turned on?',['After the world is built','From day one','Never'],1,'Converting later is painful.'),
     Q('What does PCG do?',['Plays cutscenes','Places content by rules you set','Generates music'],1,'Change a rule and the whole region updates.'),
     Q('Which locations do you build by hand?',['Background props','Landmarks, mission spaces and story interiors','Grass'],1,'Players look closest at hero locations.'),
     Q('Where do AI agents build?',['Directly in your project','In a Sandbox copy until you approve','On the website'],1,'Nothing touches your project without approval.')],
  6:[Q('What is the seed cast?',['The voice actors','A small set of hand-made base characters the system multiplies','The final crowd'],1,'Seeds plus rules make thousands of people.'),
     Q('What should stay hand-written?',['Main story dialogue','Every bark','Nothing'],0,'No major game has handed its main quest to AI.'),
     Q('How fast should live AI replies be to feel natural?',['Under about 0.8 seconds','Under 10 seconds','It does not matter'],0,'Longer feels like a stall.'),
     Q('How do you keep live AI affordable?',['Use it for every NPC','Cap length and limit which NPCs use it','Turn off subtitles'],1,'Every generated line costs money per player.')],
  7:[Q('Who holds authorship of songs made on Suno paid plans?',['You alone','Suno, which licenses them to you','Nobody'],1,'Paid plans give a commercial license; authorship stays with Suno.'),
     Q('How can you add human authorship to AI music?',['Rename the file','Write your own lyrics or edit the music','Play it louder'],1,'Purely AI-generated music likely cannot be copyrighted in the U.S.'),
     Q('What do MetaSounds do here?',['Blend music layers as the game state changes','Record voices','Compress audio'],0,'That is adaptive music.'),
     Q('What should always be clear in the mix?',['Footsteps','Dialogue','Wind'],1,'Players must hear what characters say.')],
  8:[Q('What is a vertical slice?',['A trailer','One region finished to final quality in every way','A save file'],1,'It sets the standard the loop copies.'),
     Q('When does the expansion loop stop?',['After 10 passes','When every requirement is met','When you run out of credits'],1,'Requirements define done.'),
     Q('What happens when an automatic check fails?',['It merges anyway','The work goes back and never reaches your project','The project is deleted'],1,'Only approved, passing work merges.'),
     Q('What do you do after each merge?',['Nothing','Retest the first mission and the slice','Delete old saves'],1,'Catch regressions the same day.')],
  9:[Q('How do you fix performance?',['Lower every setting','Measure, find the real bottleneck, fix it, measure again','Buy a faster PC'],1,'Fixing anything else barely helps.'),
     Q('Where do you test the Shipping build?',['Only in the editor','On a different PC','On your phone'],1,'Missing files show up on another machine.'),
     Q('What must patches preserve?',['Old saves','The trailer','Your desktop wallpaper'],0,'Players should never lose progress.'),
     Q('What do you back up at release?',['Only the build','The build and the exact project that made it','Nothing'],1,'You need both to patch.')]
};

export function lessonVideo(slug){
  try{const m=JSON.parse(fs.readFileSync(path.join(DATA_DIR,'course-media.json'),'utf8'));return typeof m[slug]==='string'?m[slug]:null;}catch{return null;}
}
export function gradeQuiz(phase,answers){
  const qs=QUIZZES[phase];if(!qs)return null;
  const results=qs.map((q,i)=>({correct:Number(answers?.[i])===q.answer,why:q.why}));
  const score=results.filter(r=>r.correct).length;
  return {score,total:qs.length,passed:score>=Math.ceil(qs.length*0.75),results};
}
export const publicQuiz=phase=>(QUIZZES[phase]||[]).map(({q,options})=>({q,options}));
