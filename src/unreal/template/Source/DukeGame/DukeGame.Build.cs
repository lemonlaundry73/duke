using UnrealBuildTool;

public class DukeGame : ModuleRules
{
	public DukeGame(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] {
			"Core", "CoreUObject", "Engine", "InputCore", "EnhancedInput",
			"Json", "JsonUtilities", "AIModule", "PhysicsCore"
		});
	}
}
