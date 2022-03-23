/* eslint-disable prefer-template */
import {
  EXTENSION_NAME_NEXUS,
  EXTENSION_URL_GITHUB,
  EXTENSION_URL_NEXUS,
} from "./index.metadata";
import {
  ArchiveLayout,
  ARCHIVE_ONLY_CANONICAL_PREFIX,
  CetLayout,
  InvalidLayout,
  LayoutDescriptions,
  Red4ExtLayout,
  RedscriptLayout,
} from "./installers.layouts";
import { InstallDecision, InstallerType } from "./installers.types";
import { VortexApi, VortexDialogResult, VortexLogFunc } from "./vortex-wrapper";

export const enum InstallChoices {
  Proceed = "Yes, Install To Staging Anyway",
  Cancel = "No, Cancel Installation",
}

const heredoc = (str: string) =>
  str
    .replace(/^[ \t]+/gm, "") // Remove leading whitespace on each row
    .replace("|", " ") // Drop |'s that protected leading whitespace
    .replace(/\n{3,}/g, "\n\n"); // And squash extra empty lines into one empty max

const INSTRUCTIONS_TO_FIX_IN_STAGING = `
    If you want to proceed, I'll install *EVERYTHING* in the mod
    into the Staging folder. You will need to check and possibly
    fix the mod manually before you enable it. (The Staging folder
    is where all installed mods live - they only go into the game
    mod folder when you \`enable\` the mod.)

    To do so, once the mod is installed, click on the File Manager
    option in the action menu (arrow down next to Remove on the right
    in the mod listing.) Make your changes and just close the Manager.
    `;

const INSTRUCTIONS_TO_REPORT_ISSUE = `
    Please let the team know if this looks like a valid mod. You can
    reach us at:

    - ${EXTENSION_URL_NEXUS} (or just search for ${EXTENSION_NAME_NEXUS})
    - ${EXTENSION_URL_GITHUB}
    `;

export const promptUserToInstallOrCancel = async (
  api: VortexApi,
  title: string,
  explanation: string,
): Promise<InstallDecision> => {
  const dialogResponse: VortexDialogResult = await api.showDialog(
    "question",
    title,
    {
      md: heredoc(explanation),
    },
    [{ label: InstallChoices.Cancel }, { label: InstallChoices.Proceed }],
  );

  const installDecision =
    dialogResponse.action === InstallChoices.Proceed
      ? InstallDecision.UserWantsToProceed
      : InstallDecision.UserWantsToCancel;

  return installDecision;
};

export const promptUserOnConflict = async (
  api: VortexApi,
  installerType: InstallerType,
  files: string[],
): Promise<InstallDecision> => {
  api.log(
    `error`,
    `${installerType}: conflicting layouts, can't install automatically`,
    files,
  );
  api.log(`info`, `Asking user to proceed/cancel installation`);

  const supportedLayoutsDescription = LayoutDescriptions.get(installerType);

  if (supportedLayoutsDescription === undefined) {
    const errorCausingAnExitHopefullyInTestsAndNotInProd = `No layout description found for ${installerType}, exiting`;

    api.log(`error`, errorCausingAnExitHopefullyInTestsAndNotInProd);
    return Promise.reject(new Error(errorCausingAnExitHopefullyInTestsAndNotInProd));
  }

  const explanationForUser = `
    You need to decide if you want to proceed or not. I can't
    figure out the intended structure of this mod.

    ${INSTRUCTIONS_TO_FIX_IN_STAGING}

    These are the supported layouts for ${installerType} mods:

    ${supportedLayoutsDescription}

    ${INSTRUCTIONS_TO_REPORT_ISSUE}

    These are the files I found in the mod:

    \`\`\`
    ${files.join(`\n`)}
    \`\`\``;

  return promptUserToInstallOrCancel(
    api,
    `Can't Figure Out How To Install This Mod!`,
    explanationForUser,
  );
};

// Should try to get this doc in a stronger format like using the layout
//
// Improvement: https://github.com/E1337Kat/cyberpunk2077_ext_redux/issues/75
//
// Move this to LayoutDescriptions!
const red4extLayoutDescription = heredoc(`
  Supported layouts for Red4Ext mods:

  - \`.\\red4ext\\plugins\\[modname]\\[*.dll + any files/subdirs]   (canonical)\`
    - (if any) \`.\\archive\\pc\\mod\\*.archive\`
  - \`.\\red4ext\\plugins\\[*.dll + any files/subdirs]              (I can fix this to canonical)\`   
    - (if any) \`.\\archive\\pc\\mod\\*.archive\`
  - \`.\\[modname]\\[*.dll + any files/subdirs]                     (I can fix this to canonical)\`   
    - (if any) \`.\\*.archive\`
  - \`.\\*.dll                                                      (I can fix this to canonical)\`   
    - (if any) \`.\\**\\[any files/subdirs]
    - (if any) \`.\\*.archive\``);

export const showRed4ExtReservedDllErrorDialog = (
  api: VortexApi,
  message: string,
  dangerPaths: string[],
): void => {
  api.showDialog(
    "error",
    message,
    {
      md: heredoc(`
        Installation cancelled!

        Because this mod has DLLs, it seems like it might be a Red4Ext mod, but I can't install
        DLLs that look like they could conflict with known DLL files!

        ${red4extLayoutDescription}

        If any of the following contain DLLs that this mod _should_ install or this isn't a Red4Ext
        mod at all, please report a bug and we'll see how we can handle it better! In the meanwhile,        
        you can manually install the files (but please be careful!)

        I cancelled the installation because of these files:

        \`\`\`
        ${dangerPaths.join("\n")}
        \`\`\``),
    },
    [{ label: "Understood!" }],
  );
};

export const showRed4ExtStructureErrorDialog = (
  api: VortexApi,
  message: string,
  files: string[],
  isMultiple?: InvalidLayout,
): void => {
  const problemDescription = isMultiple
    ? `
        I found several possible Red4Ext mod layouts, but can only support one layout per mod.`
    : `
        This looks like a Red4Ext mod, but there are files outside any structure that I can handle.`;

  api.showDialog(
    "error",
    message,
    {
      // Improvement: https://github.com/E1337Kat/cyberpunk2077_ext_redux/issues/76
      md: heredoc(
        `Installation cancelled!

        ${problemDescription} This mod can't be installed! You'll have to fix it
        _outside_ Vortex for now!

         Supported layouts:

         ${red4extLayoutDescription}

         These are the files I found in the mod:

         \`\`\`
         ${files.join("\n")}
         \`\`\``,
      ),
    },
    [{ label: "Understood!" }],
  );
};

export const showArchiveInstallWarning = (
  api: VortexApi,
  warnAboutSubdirs: boolean,
  warnAboutToplevel: boolean,
  files: string[],
): void => {
  const subdirWarning = warnAboutSubdirs
    ? `
      - There are \`*.archive\` files in subdirectories

      The game does not read archives in subdirectories. You may be expected
      to pick some of these to place into \`${ARCHIVE_ONLY_CANONICAL_PREFIX}\`.
      `
    : `\n`;

  const toplevelWarning = warnAboutToplevel
    ? `
      - There's more than one top-level \`*.archive\`

      This might be intentional, it's perfectly OK to have multiple archives if
      they do different things. However, it could also be an oversight, or you
      might be expected to pick only some of these to place into \`${ARCHIVE_ONLY_CANONICAL_PREFIX}\`
      `
    : `\n`;

  api.showDialog(
    "info",
    "Mod Installed But May Need Manual Adjustment!",
    {
      md: heredoc(
        `I installed the mod, but it may need to be manually adjusted because:

        ${subdirWarning}

        ${toplevelWarning}

        Make sure to read any instructions the mod might have, and then if necessary
        adjust the installation manually.

        ${INSTRUCTIONS_TO_FIX_IN_STAGING}

        If you want to keep multiple variants of the mod (for different colors, for example),
        you can click 'Reinstall' in the Action Menu, and select to install a variant (give
        it a good name!).

        These are the files I installed:

        \`\`\`
        ${files.join("\n")}
        \`\`\``,
      ),
    },
    [{ label: "Understood!" }],
  );
};

// Should try to carry in some more diagnostic information to the user
// Improvement: https://github.com/E1337Kat/cyberpunk2077_ext_redux/issues/81
export const showMultiTypeStructureErrorDialog = (
  api: VortexApi,
  message: string,
  files: string[],
): void => {
  api.showDialog(
    "error",
    message,
    {
      // Improvement: https://github.com/E1337Kat/cyberpunk2077_ext_redux/issues/76
      md: heredoc(`
        Installation cancelled!

        It looks like this mod combined multiple types of mods, but I can only
        support them if they're well structured. Each different type within the
        mod has to use the canonical layout for that type. (When it's just one
        type of mod, I can make more assumptions and can support more possible
        layouts.)

        The installation was cancelled, so you'll have to fix the mod _outside_
        Vortex for now.

        These are the layouts I can support in combinations (NOTE: there can't
        be any other kinds of files outside these.):

        - \`${CetLayout.Canon}\`
        - \`${RedscriptLayout.Canon}\`
        - \`${Red4ExtLayout.Canon}\`
        - \`${ArchiveLayout.Canon}\`
        - \`${ArchiveLayout.Heritage}\`

        These are the files I found in the mod:

        \`\`\`
        ${files.join("\n")}
        \`\`\``),
    },
    [{ label: "Understood!" }],
  );
};

// Example notif + dialog
/*
  api.sendNotification({
    type: "warning",
    title: message,
    message: "Check mod files in File Manager!",
    actions: [
      {
        title: "More info",
        action: (dismiss) => {
          api.showDialog(
            "info",
            "Archive Files Moved To Top Level",
            {
              text:
                "There were some archive files outside the canonical mod folder " +
                ".\\archive\\pc\\mod or inside a subdirectory. " +
                "The installer moved them all to the top level. Please check " +
                "the mod in File Manager (Down Arrow next to the Remove action " +
                "in the mod list) to verify the files are correct!",
            },
            [{ label: "Close", action: () => dismiss() }],
          );
        },
      },
    ],
  });
  */

export const promptUserToInstallOrCancelOnReachingFallback = (
  api: VortexApi,
  files: string[],
) => {
  api.log("info", `Fallback installer reached, prompting to proceed/cancel`, files);

  const fallbackTitle = `You Have Reached The Fallback Installer!`;

  const fallbackExplanation = `
    I wasn't able to figure out what kind of mod this is, so you have
    reached the fallback installer (ta-dah!)

    ${INSTRUCTIONS_TO_FIX_IN_STAGING}

    ${INSTRUCTIONS_TO_REPORT_ISSUE}

    These are the files in the mod:

    \`\`\`
    ${files.join("\n")}
    \`\`\`
    `;

  return promptUserToInstallOrCancel(api, fallbackTitle, fallbackExplanation);
};

export const wolvenKitDesktopFoundErrorDialog = (
  api: VortexApi,
  log: VortexLogFunc,
  message: string,
  files: string[],
  _installable: string[],
) => {
  log("error", `CoreWolvenKit installer: ${message}`, files);

  // It'd be nicer to move at least the long text out, maybe constant
  // for text + function for handling the boilerplate?
  api.showDialog(
    "info",
    message,
    {
      md:
        "I think you accidentally grabbed the wrong file. This installer can " +
        "help you install WolvenKit Console which is an Optional file on the " +
        "[Nexus download page](https://www.nexusmods.com/cyberpunk2077/mods/2201?tab=files) " +
        "The file you tried to install is WolvenKit Desktop which cannot be " +
        "installed through Vortex",
    },
    [{ label: "Ok, I'll get WolvenKit.Console" }],
  );
};
