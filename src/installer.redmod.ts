import path from "path";
import {
  map,
  filter,
  flatten,
} from "fp-ts/ReadonlyArray";
import { pipe } from "fp-ts/lib/function";
import {
  FileTree,
  findDirectSubdirsWithSome,
  filesUnder,
  Glob,
  FILETREE_ROOT,
  sourcePaths,
  subdirsIn,
  pathInTree,
} from "./filetree";
import {
  REDMOD_INFO_FILENAME,
  MaybeInstructions,
  NoInstructions,
  REDmodLayout,
  InvalidLayout,
  REDMOD_BASEDIR,
} from "./installers.layouts";
import {
  instructionsForSameSourceAndDestPaths,
  instructionsForSourceToDestPairs,
  moveFromTo,
  useFirstMatchingLayoutForInstructions,
} from "./installers.shared";
import {
  VortexApi,
  VortexTestResult,
  VortexInstallResult,
} from "./vortex-wrapper";
import {
  InstallerType,
  ModInfo,
  V2077InstallFunc,
  V2077TestFunc,
} from "./installers.types";
import { showWarningForUnrecoverableStructureError } from "./ui.dialogs";
import { Features } from "./features";

// REDmod
//
// REDmod type mods are detected by:
//
// Canonical:
//  - .\mods\MODNAME\info.json
//
// Fixable: no

const matchREDmodInfoJson = (f: string): boolean =>
  path.basename(f) === REDMOD_INFO_FILENAME;

const findNamedREDmodDirs = (fileTree: FileTree): string[] =>
  findDirectSubdirsWithSome(FILETREE_ROOT, matchREDmodInfoJson, fileTree);

const findAllREDmodLookingDirs = (fileTree: FileTree): string[] =>
  subdirsIn(REDMOD_BASEDIR, fileTree);

const findValidCanonicalREDmodDirs = (fileTree: FileTree): string[] =>
  findDirectSubdirsWithSome(REDMOD_BASEDIR, matchREDmodInfoJson, fileTree);

export const detectNamedREDmodLayout = (fileTree: FileTree): boolean =>
  findNamedREDmodDirs(fileTree).length > 0;

export const detectCanonREDmodLayout = (fileTree: FileTree): boolean =>
  pathInTree(REDMOD_BASEDIR, fileTree);

export const detectREDmodLayout = (fileTree: FileTree): boolean =>
  detectCanonREDmodLayout(fileTree) || detectNamedREDmodLayout(fileTree);

//
// Layouts
//

export const namedREDmodLayout = (
  api: VortexApi,
  _modName: string,
  fileTree: FileTree,
): MaybeInstructions => {
  const hasNamedREDmods = detectNamedREDmodLayout(fileTree);

  if (!hasNamedREDmods) {
    return NoInstructions.NoMatch;
  }

  const allNamedREDmodDirsInCaseThereIsExtraStuff = findNamedREDmodDirs(fileTree);

  const allNamedREDmodFiles =
    pipe(
      allNamedREDmodDirsInCaseThereIsExtraStuff,
      map((namedSubdir) => filesUnder(namedSubdir, Glob.Any, fileTree)),
      flatten,
    );

  const allToNamedWithSubdirAsModname =
    pipe(
      allNamedREDmodFiles,
      map(moveFromTo(FILETREE_ROOT, REDMOD_BASEDIR)),
    );

  const allNamedInstructions =
    instructionsForSourceToDestPairs(allToNamedWithSubdirAsModname);

  return {
    kind: REDmodLayout.Named,
    instructions: allNamedInstructions,
  };
};

export const canonREDmodLayout = (
  api: VortexApi,
  modName: string,
  fileTree: FileTree,
): MaybeInstructions => {
  if (!detectCanonREDmodLayout(fileTree)) {
    return NoInstructions.NoMatch;
  }

  const allREDmodLookingDirs = findAllREDmodLookingDirs(fileTree);
  const allValidCanonicalREDmodDirs = findValidCanonicalREDmodDirs(fileTree);

  if (allValidCanonicalREDmodDirs.length !== allREDmodLookingDirs.length) {
    const invalidDirs = pipe(
      allREDmodLookingDirs,
      filter((dir) => !allValidCanonicalREDmodDirs.includes(dir)),
    );

    api.log(`error`, `${InstallerType.REDmod}: these directories don't look like valid REDmods: ${invalidDirs.join(`, `)}`);

    return InvalidLayout.Conflict;
  }

  const allCanonAndSubdirFiles =
    filesUnder(REDMOD_BASEDIR, Glob.Any, fileTree);

  const allCanonInstructions =
    instructionsForSameSourceAndDestPaths(allCanonAndSubdirFiles);

  return {
    kind: REDmodLayout.Canon,
    instructions: allCanonInstructions,
  };
};

//
// Vortex
//

//
// testSupported
//

export const testForREDmod: V2077TestFunc = (
  _api: VortexApi,
  fileTree: FileTree,
): Promise<VortexTestResult> => Promise.resolve({
  supported: detectREDmodLayout(fileTree),
  requiredFiles: [],
});

//
// install
//

// Install the REDmod stuff, as well as any archives we find
export const installREDmod: V2077InstallFunc = async (
  api: VortexApi,
  fileTree: FileTree,
  _modInfo: ModInfo,
  _features: Features,
): Promise<VortexInstallResult> => {
  //
  const allPossibleRedmodLayouts = [
    namedREDmodLayout,
    canonREDmodLayout,
  ];

  const selectedInstructions = useFirstMatchingLayoutForInstructions(
    api,
    undefined,
    fileTree,
    allPossibleRedmodLayouts,
  );

  if (
    selectedInstructions === NoInstructions.NoMatch ||
    selectedInstructions === InvalidLayout.Conflict
  ) {
    const errorMessage = `Didn't Find Expected REDmod Installation!`;

    api.log(
      `error`,
      `${InstallerType.REDmod}: ${errorMessage}`,
      sourcePaths(fileTree),
    );

    showWarningForUnrecoverableStructureError(
      api,
      InstallerType.REDmod,
      errorMessage,
      sourcePaths(fileTree),
    );

    return Promise.reject(new Error(errorMessage));
  }

  return Promise.resolve({ instructions: selectedInstructions.instructions });
};
