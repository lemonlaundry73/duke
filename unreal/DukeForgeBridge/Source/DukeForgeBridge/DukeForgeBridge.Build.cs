using UnrealBuildTool;
public class DukeForgeBridge : ModuleRules
{
    public DukeForgeBridge(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[] { "Core" });
        PrivateDependencyModuleNames.AddRange(new string[] { "CoreUObject", "Engine", "UnrealEd", "Projects" });
    }
}
