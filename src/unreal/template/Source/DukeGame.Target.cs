using UnrealBuildTool;
using System.Collections.Generic;

public class DukeGameTarget : TargetRules
{
	public DukeGameTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("DukeGame");
	}
}
