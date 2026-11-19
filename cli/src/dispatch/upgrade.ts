import type { ParsedArgs } from "../cli/args.js";
import { writeStdoutFully } from "../cli/stdout.js";
import { upgrade, UpgradeError } from "../commands/upgrade.js";
import {
	upgradeApplyChoice,
	UpgradeApplyChoiceError,
} from "../commands/upgrade_apply_choice.js";
import {
	upgradeChoose,
	UpgradeChooseError,
} from "../commands/upgrade_choose.js";
import { upgradePlan } from "../commands/upgrade_plan.js";
import { syncProjectsAfterUpgrade } from "../commands/upgrade_projects.js";
import { resolveLibraryRoot } from "../library_root.js";
import { reportRegisteredProjectSync } from "../report/projects.js";
import {
	reportUpgrade,
	reportUpgradeApplyChoice,
	reportUpgradeChoose,
	reportUpgradePlan,
} from "../report/upgrade.js";

export async function runUpgrade({ positional, flags }: ParsedArgs): Promise<number> {
  try {
    if (positional[0] === "choose") {
      const result = await upgradeChoose({
        choiceInput:
          (flags["choice"] as string | undefined) ?? positional[1],
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        libraryRoot:
          (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
        registry: flags["registry"] as string | undefined,
        apply: flags["apply"] === true,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportUpgradeChoose(result);
      }
      return result.execution.status === "unsupported" ? 1 : 0;
    }
    if (positional[0] === "apply-choice") {
      const choiceId = positional[1];
      if (!choiceId) {
        console.error("error: usage: anamnesis upgrade apply-choice <id>");
        return 1;
      }
      const result = upgradeApplyChoice({
        choiceId,
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        libraryRoot:
          (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
        registry: flags["registry"] as string | undefined,
        apply: flags["apply"] === true,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportUpgradeApplyChoice(result);
      }
      return result.status === "unsupported" ? 1 : 0;
    }
    if (positional[0] === "plan") {
      const result = upgradePlan({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        libraryRoot:
          (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
        registry: flags["registry"] as string | undefined,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportUpgradePlan(result);
      }
      return 0;
    }
    const result = upgrade({
      registry: flags["registry"] as string | undefined,
      apply: flags["apply"] === true,
    });
		const projectSync =
			flags["apply"] === true
				? syncProjectsAfterUpgrade(result, {
						registryPath: flags["registry-file"] as string | undefined,
						libraryRoot: resolveLibraryRoot(),
					})
				: undefined;
    if (flags["json"] === true) {
			await writeStdoutFully(
				JSON.stringify(
					projectSync ? { package: result, projects: projectSync } : result,
					null,
					2,
				) + "\n",
			);
    } else {
      reportUpgrade(result, process.cwd());
			if (projectSync) reportRegisteredProjectSync(projectSync);
    }
    return 0;
  } catch (e) {
    if (
      e instanceof UpgradeError ||
      e instanceof UpgradeApplyChoiceError ||
      e instanceof UpgradeChooseError
    ) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
