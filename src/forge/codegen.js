// Duke Forger code and level generation for the Unreal worker: C++ classes written into the project,
// Python level scripts run through the Duke Forger plugin inside the editor, and runtime tests run in PIE.
// Everything here produces real project files or real editor operations; nothing is simulated.

export const safeName=s=>{const n=String(s||'DukeGame').replace(/[^A-Za-z0-9]/g,'');return /^[A-Za-z]/.test(n)?n.slice(0,30):('Duke'+n).slice(0,30);};
const api=name=>`${name.toUpperCase()}_API`;
const py=v=>JSON.stringify(v);

// ---------------------------------------------------------------- the start map every new project gets
export function startMapScript(){
  return `import unreal
b = bridge
if not unreal.EditorAssetLibrary.does_asset_exist('/Game/Maps/DukeStart'):
    b.new_level('/Game/Maps/DukeStart')
else:
    b.load_level('/Game/Maps/DukeStart')
b.clear_tag('DukeStart')
t = ('Duke', 'DukeStart')
b.spawn_mesh('Ground', (0, 0, -10), (40, 40, 0.2), tags=t)
b.spawn_class('Sun', '/Script/Engine.DirectionalLight', (0, 0, 800), yaw=-35, tags=t).set_actor_rotation(unreal.Rotator(roll=0, pitch=-40, yaw=-35), False)
b.spawn_class('Sky', '/Script/Engine.SkyAtmosphere', (0, 0, 0), tags=t)
sky = b.spawn_class('SkyLight', '/Script/Engine.SkyLight', (0, 0, 300), tags=t)
sky.get_component_by_class(unreal.SkyLightComponent).set_editor_property('real_time_capture', True)
b.spawn_class('PlayerStart', '/Script/Engine.PlayerStart', (0, 0, 100), tags=t)
b.save_all()
result = b.describe('DukeStart')
`;
}

// ---------------------------------------------------------------- acceptance test 1: one actor through the bridge
export function acceptanceActorScript(){
  return `import unreal
b = bridge
b.load_level('/Game/Maps/DukeStart')
b.clear_tag('DukeAcceptance')
mat = b.color_material('MI_DukeAcceptance', (0.1, 0.45, 1.0))
b.spawn_mesh('DukeAcceptanceCube', (300, 0, 50), (1, 1, 1), yaw=30, material=mat, tags=('Duke', 'DukeAcceptance'))
b.save_all()
result = b.describe('DukeAcceptance')
`;
}
export const acceptanceActorTest={name:'Actor placed by the automation bridge exists in Play-In-Editor',
  steps:[{op:'start_pie'},{op:'wait',s:2},{op:'find',tag:'DukeAcceptance',save:'cube'},{op:'location',actor:'cube',save:'cube_loc'},
    {op:'screenshot',name:'acceptance_actor'},{op:'stop_pie'}],
  asserts:['cube_count == 1']};

// ---------------------------------------------------------------- the director's command interpreter
const NUM={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,a:1,an:1};
const COLORS={red:[1,0.05,0.05],blue:[0.1,0.3,1],green:[0.1,0.8,0.2],yellow:[1,0.85,0.1],white:[0.9,0.9,0.9],black:[0.03,0.03,0.03],orange:[1,0.45,0.05],purple:[0.5,0.15,0.9],gray:[0.4,0.4,0.4],grey:[0.4,0.4,0.4]};
const count=(text,word)=>{const m=new RegExp(`(\\d+|${Object.keys(NUM).join('|')})\\s+(?:\\w+\\s+){0,2}${word}`,'i').exec(text);return m?(Number(m[1])||NUM[m[1].toLowerCase()]||1):(new RegExp(`\\b${word}`,'i').test(text)?1:0);};

// Turns a natural-language room request into a structured spec. Returns null when the request is outside
// what the built-in interpreter understands (then a connected AI model has to plan it).
export function interpretRoom(text){
  const t=String(text||'').toLowerCase();
  if(!/\broom\b/.test(t))return null;
  const cube=/(red|blue|green|yellow|white|black|orange|purple|gr[ae]y)?\s*cube/.exec(t);
  const spec={
    floor:/\bfloor\b/.test(t),
    walls:Math.min(4,count(t,'walls?'))||(/\bwalls?\b/.test(t)?4:0),
    lights:Math.min(8,count(t,'lights?')),
    playerStart:/player\s*start|spawn/.test(t),
    cube:cube?{color:cube[1]||'white',rgb:COLORS[cube[1]||'white']}:null,
    door:/\bdoor\b/.test(t)?{opensOnApproach:/(open|opens|opening).*(approach|near|close|walk)/.test(t)}:null,
  };
  if(!spec.floor&&!spec.walls&&!spec.door)return null;
  return spec;
}

export function roomPlan(spec){
  const tasks=[];
  if(spec.door)tasks.push({role:'Gameplay engineer',title:spec.door.opensOnApproach?'Write a C++ door that opens when the player approaches':'Write a C++ door actor'});
  tasks.push({role:'World builder',title:`Build the room: ${[spec.floor&&'floor',spec.walls&&`${spec.walls} walls`,spec.lights&&`${spec.lights} lights`,spec.playerStart&&'player start',spec.cube&&`${spec.cube.color} cube`,spec.door&&'door'].filter(Boolean).join(', ')}`});
  tasks.push({role:'Build engineer',title:'Compile the project with Unreal Build Tool'});
  tasks.push({role:'QA',title:spec.door?.opensOnApproach?'Play-In-Editor test: the door is closed at the start and opens when the player approaches':'Play-In-Editor test: everything spawns'});
  tasks.push({role:'Build engineer',title:'Commit the verified change to Git'});
  return tasks;
}

export function doorSources(name){
  const h=`// Created by Duke Forger: a door that swings open when the player comes near, and closes again after.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DukeDoor.generated.h"

class USceneComponent;
class UStaticMeshComponent;

UCLASS()
class ${api(name)} ADukeDoor : public AActor
{
	GENERATED_BODY()

public:
	ADukeDoor();
	virtual void Tick(float DeltaSeconds) override;

	/** How close (in cm, measured flat) the player must be for the door to open. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Door")
	float TriggerDistance = 300.f;

	/** How far the door swings open, in degrees. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Door")
	float OpenAngle = 95.f;

	/** Opening speed: fraction of the full swing per second. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Door")
	float OpenSpeed = 2.5f;

	/** 0 = closed, 1 = fully open. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Door")
	float OpenAlpha = 0.f;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Door")
	bool bPlayerNear = false;

protected:
	UPROPERTY(VisibleAnywhere, Category = "Door")
	TObjectPtr<USceneComponent> Root;

	UPROPERTY(VisibleAnywhere, Category = "Door")
	TObjectPtr<USceneComponent> Hinge;

	UPROPERTY(VisibleAnywhere, Category = "Door")
	TObjectPtr<UStaticMeshComponent> Leaf;
};
`;
  const cpp=`// Created by Duke Forger.
#include "DukeDoor.h"

#include "Components/SceneComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Pawn.h"
#include "Kismet/GameplayStatics.h"
#include "UObject/ConstructorHelpers.h"

ADukeDoor::ADukeDoor()
{
	PrimaryActorTick.bCanEverTick = true;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Root->SetMobility(EComponentMobility::Movable);
	RootComponent = Root;

	// The hinge sits on the left edge of a 120 cm wide doorway centred on the actor.
	Hinge = CreateDefaultSubobject<USceneComponent>(TEXT("Hinge"));
	Hinge->SetupAttachment(Root);
	Hinge->SetMobility(EComponentMobility::Movable);
	Hinge->SetRelativeLocation(FVector(0.f, -60.f, 0.f));

	Leaf = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Leaf"));
	Leaf->SetupAttachment(Hinge);
	Leaf->SetMobility(EComponentMobility::Movable);
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (Cube.Succeeded())
	{
		Leaf->SetStaticMesh(Cube.Object);
	}
	// The engine cube is 100 cm; this makes a 10 x 120 x 220 cm leaf whose left edge is on the hinge.
	Leaf->SetRelativeLocation(FVector(0.f, 60.f, 110.f));
	Leaf->SetRelativeScale3D(FVector(0.1f, 1.2f, 2.2f));
	Leaf->SetCollisionProfileName(TEXT("BlockAll"));
}

void ADukeDoor::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	bPlayerNear = Player != nullptr && FVector::Dist2D(Player->GetActorLocation(), GetActorLocation()) <= TriggerDistance;

	OpenAlpha = FMath::FInterpConstantTo(OpenAlpha, bPlayerNear ? 1.f : 0.f, DeltaSeconds, OpenSpeed);
	Hinge->SetRelativeRotation(FRotator(0.f, OpenAlpha * OpenAngle, 0.f));
}
`;
  return {[`Source/${name}/DukeDoor.h`]:h,[`Source/${name}/DukeDoor.cpp`]:cpp};
}

// Room: 10 x 10 m, 3 m walls, doorway in the west wall (x = -500) at y = 0.
export function roomScript(name,spec,map='/Game/Maps/DukeRoom'){
  const L=[`import unreal
b = bridge
if not unreal.EditorAssetLibrary.does_asset_exist(${py(map)}):
    b.new_level(${py(map)})
else:
    b.load_level(${py(map)})
b.clear_tag('DukeRoom')
t = ('Duke', 'DukeRoom')
made = []
b.spawn_class('Sun', '/Script/Engine.DirectionalLight', (0, 0, 900), tags=t).set_actor_rotation(unreal.Rotator(roll=0, pitch=-50, yaw=40), False)
b.spawn_class('Sky', '/Script/Engine.SkyAtmosphere', (0, 0, 0), tags=t)
sky = b.spawn_class('SkyLight', '/Script/Engine.SkyLight', (0, 0, 400), tags=t)
sky.get_component_by_class(unreal.SkyLightComponent).set_editor_property('real_time_capture', True)`];
  if(spec.floor)L.push(`made.append(b.spawn_mesh('Floor', (0, 0, -10), (10.4, 10.4, 0.2), tags=t))`);
  const walls=[`made.append(b.spawn_mesh('Wall_North', (0, 510, 150), (10.4, 0.2, 3), tags=t))`,
    `made.append(b.spawn_mesh('Wall_South', (0, -510, 150), (10.4, 0.2, 3), tags=t))`,
    `made.append(b.spawn_mesh('Wall_East', (510, 0, 150), (0.2, 10.4, 3), tags=t))`];
  const westSolid=`made.append(b.spawn_mesh('Wall_West', (-510, 0, 150), (0.2, 10.4, 3), tags=t))`;
  const westDoor=[`made.append(b.spawn_mesh('Wall_West_A', (-510, -285, 150), (0.2, 4.5, 3), tags=t))`,
    `made.append(b.spawn_mesh('Wall_West_B', (-510, 285, 150), (0.2, 4.5, 3), tags=t))`,
    `made.append(b.spawn_mesh('Wall_West_Header', (-510, 0, 260), (0.2, 1.2, 0.8), tags=t))`];
  for(let i=0;i<Math.min(spec.walls,3);i++)L.push(walls[i]);
  if(spec.walls>=4)L.push(...(spec.door?westDoor:[westSolid]));
  const lightPos=[[-200,0,250],[200,0,250],[0,-250,250],[0,250,250],[-250,-250,250],[250,250,250],[-250,250,250],[250,-250,250]];
  for(let i=0;i<spec.lights;i++)L.push(`made.append(b.spawn_point_light('Light_${i+1}', ${py(lightPos[i])}, intensity=8000, radius=1600, tags=t))`);
  if(spec.playerStart)L.push(`made.append(b.spawn_class('PlayerStart', '/Script/Engine.PlayerStart', (250, 0, 100), yaw=180, tags=t))`);
  if(spec.cube)L.push(`mat = b.color_material('MI_Duke_${spec.cube.color}', ${py(spec.cube.rgb)})
made.append(b.spawn_mesh('Cube_${spec.cube.color}', (0, 250, 50), (1, 1, 1), material=mat, tags=('Duke', 'DukeRoom', 'DukeCube')))`);
  if(spec.door)L.push(`made.append(b.spawn_class('Door', '/Script/${name}.DukeDoor', (-510, 0, 0), tags=('Duke', 'DukeRoom', 'DukeDoor')))`);
  L.push(`b.save_all()
result = {'map': ${py(map)}, 'actors': b.describe('DukeRoom')}
`);
  return L.join('\n');
}

export function roomTest(spec){
  const steps=[{op:'start_pie'},{op:'wait',s:1.5},{op:'player_location',save:'player_start'}];
  const asserts=[];
  if(spec.cube){steps.push({op:'find',tag:'DukeCube',save:'cube'});asserts.push('cube_count == 1');}
  if(spec.door){
    steps.push({op:'find',tag:'DukeDoor',save:'door'},{op:'get',actor:'door',prop:'open_alpha',save:'door_closed_at_start'});
    if(spec.door.opensOnApproach){
      steps.push({op:'screenshot',name:'room_start'},{op:'teleport_player',near:'door',offset:[160,0,100]},{op:'wait',s:1.5},
        {op:'get',actor:'door',prop:'open_alpha',save:'door_open_near'},{op:'get',actor:'door',prop:'player_near',save:'player_near'},{op:'screenshot',name:'door_open'},
        {op:'teleport_player',near:'door',offset:[700,0,100]},{op:'wait',s:1.5},{op:'get',actor:'door',prop:'open_alpha',save:'door_after_leaving'});
      asserts.push('door_closed_at_start < 0.05','player_near == True','door_open_near > 0.95','door_after_leaving < 0.05');
    }
  }else steps.push({op:'screenshot',name:'room'});
  steps.push({op:'stop_pie'});
  return {name:'Room and door Play-In-Editor test',steps,asserts};
}

// When an AI model is connected, it plans requests the built-in interpreter does not cover.
export const PLANNER_SYSTEM=`You are the Director of Duke Forger, planning work inside a real Unreal Engine 5 C++ project.
Return ONLY JSON: {"summary": str, "files": {"Source/<Module>/X.h": "...", ...}, "level_script": str, "test": {"name": str, "steps": [...], "asserts": [...]}}
level_script is Python run inside the editor with \`unreal\` and \`bridge\` available. Bridge helpers: bridge.new_level(path), bridge.load_level(path),
bridge.clear_tag(tag), bridge.spawn_mesh(label, loc, scale, yaw=0, mesh=bridge.CUBE, material=None, tags=(...)), bridge.spawn_class(label, class_path, loc, yaw=0, props=None, tags=(...)),
bridge.spawn_point_light(label, loc, intensity, radius, tags=(...)), bridge.color_material(name, (r,g,b)), bridge.save_all(). Set \`result\` to a JSON-able summary.
Tag every actor you spawn with 'Duke' and a feature tag. C++ classes use the module's API macro and compile with Unreal Build Tool.
Test steps ops: start_pie, wait{s}, find{tag,save}, get{actor,prop,save}, location{actor,save}, teleport_player{near,offset}|{to}, player_location{save}, screenshot{name}, stop_pie.
Asserts are Python expressions over saved values. Keep changes minimal and production-quality.`;
