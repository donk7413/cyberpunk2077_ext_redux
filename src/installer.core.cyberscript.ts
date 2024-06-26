import {
  VortexApi,
  VortexTestResult,
  VortexInstallResult,
} from "./vortex-wrapper";
import {
  fileCount,
  filesUnder,
  FileTree,
  Glob,
  pathInTree,
  sourcePaths,
} from "./filetree";
import {
  CYBERSCRIPT_CORE_CETBASEDIR,
  CYBERSCRIPT_CORE_REQUIRED_FILES,
} from "./installers.layouts";
import { instructionsForSameSourceAndDestPaths } from "./installers.shared";
import {
  InstallerType,
  ModInfo,
  V2077InstallFunc,
  V2077TestFunc,
} from "./installers.types";
import { showWarningForUnrecoverableStructureError } from "./ui.dialogs";
import { FeatureSet } from "./features";

const detectCoreCyberScript = (fileTree: FileTree): boolean =>
  CYBERSCRIPT_CORE_REQUIRED_FILES.some((requiredFile) =>
    pathInTree(requiredFile, fileTree));

export const testForCoreCyberScript: V2077TestFunc = (
  _api: VortexApi,
  fileTree: FileTree,
): Promise<VortexTestResult> =>
  Promise.resolve({ supported: detectCoreCyberScript(fileTree), requiredFiles: [] });

export const installCoreCyberScript: V2077InstallFunc = (
  api: VortexApi,
  fileTree: FileTree,
  _modInfo: ModInfo,
  _features: FeatureSet,
): Promise<VortexInstallResult> => {
  const allCoreCyberScriptFiles = [
    ...filesUnder(CYBERSCRIPT_CORE_CETBASEDIR, Glob.Any, fileTree),
  ];

  const missingRequiredCoreCyberScriptFiles = !CYBERSCRIPT_CORE_REQUIRED_FILES.every(
    (requiredFile) => pathInTree(requiredFile, fileTree),
  );

  const filesOutsideKnownDirs = allCoreCyberScriptFiles.length !== fileCount(fileTree);

  if (missingRequiredCoreCyberScriptFiles || filesOutsideKnownDirs) {
    const errorMessage = missingRequiredCoreCyberScriptFiles
      ? `Didn't find all required CyberScript files!`
      : `Found files outside known CyberScript directories!`;

    api.log(
      `error`,
      `${InstallerType.CoreCyberScript}: ${errorMessage}`,
      sourcePaths(fileTree),
    );

    showWarningForUnrecoverableStructureError(
      api,
      InstallerType.CoreCyberScript,
      errorMessage,
      sourcePaths(fileTree),
    );

    return Promise.reject(new Error(errorMessage));
  }

  const allCoreCyberScriptInstructions = instructionsForSameSourceAndDestPaths(
    allCoreCyberScriptFiles,
  );

  return Promise.resolve({ instructions: allCoreCyberScriptInstructions });
};
