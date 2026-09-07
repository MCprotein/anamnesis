import * as fs from "node:fs";
import * as path from "node:path";

/** Reclaim only the observed dead owner, excluding competing reclaimers of its nonce. */
export function reclaimWorkLock<Owner extends { nonce: string }>(
  lockPath: string,
  isOwner: (value: unknown) => value is Owner,
  isDead: (owner: Owner) => boolean,
  syncParent: () => void,
): void {
  let directoryFd: number | undefined;
  let ownerFd: number | undefined;
  let claim: { path: string; fd: number; stat: fs.BigIntStats } | undefined;
  try {
    const directory = fs.lstatSync(lockPath, { bigint: true });
    if (!directory.isDirectory() || directory.isSymbolicLink()) return;
    directoryFd = fs.openSync(lockPath, fs.constants.O_RDONLY | noFollowFlag());
    if (!sameInode(directory, fs.fstatSync(directoryFd, { bigint: true }))) return;
    const ownerPath = path.join(lockPath, "owner.json");
    const ownerStat = fs.lstatSync(ownerPath, { bigint: true });
    // Check before open as well: opening a FIFO could otherwise block acquisition.
    if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) return;
    ownerFd = fs.openSync(ownerPath, fs.constants.O_RDONLY | noFollowFlag() | fs.constants.O_NONBLOCK);
    if (!sameInode(ownerStat, fs.fstatSync(ownerFd, { bigint: true }))) return;
    const recorded = fs.readFileSync(ownerFd);
    const owner: unknown = JSON.parse(recorded.toString("utf8"));
    if (!isOwner(owner) || !/^[a-f0-9]{32}$/.test(owner.nonce)) return;

    // Outside the replaceable directory: moving the lock must not release the claim.
    // EEXIST (including an abandoned claim) fails closed; never reclaim a claim.
    const claimPath = `${lockPath}.reclaim-${owner.nonce}`;
    fs.mkdirSync(claimPath, 0o700);
    // If opening the newly created claim fails, leave it failclosed.
    const claimFd = fs.openSync(claimPath, fs.constants.O_RDONLY | noFollowFlag());
    claim = { path: claimPath, fd: claimFd, stat: fs.fstatSync(claimFd, { bigint: true }) };
    if (!isDead(owner)) return;

    // Keep the original descriptors open to prevent inode reuse. Validate the exact
    // record as well as both inodes, after the death proof and under claim exclusion.
    const currentOwnerStat = fs.lstatSync(ownerPath, { bigint: true });
    if (!currentOwnerStat.isFile() || !sameInode(ownerStat, currentOwnerStat)) return;
    const currentFd = fs.openSync(ownerPath, fs.constants.O_RDONLY | noFollowFlag() | fs.constants.O_NONBLOCK);
    try {
      if (!sameInode(ownerStat, fs.fstatSync(currentFd, { bigint: true })) ||
        !recorded.equals(fs.readFileSync(currentFd))) return;
    } finally {
      fs.closeSync(currentFd);
    }
    const currentDirectory = fs.lstatSync(lockPath, { bigint: true });
    if (!currentDirectory.isDirectory() || !sameInode(directory, currentDirectory)) return;

    // A is now dead, so it cannot release; every other reclaimer of A is excluded.
    // A newer owner (including a nested reclaimer's replacement) failed validation.
    const quarantine = `${lockPath}.dead-${owner.nonce}`;
    fs.renameSync(lockPath, quarantine);
    fs.rmSync(quarantine, { recursive: true });
    syncParent();
  } catch {
    // Missing, malformed, unknown, or contended ownership: retry within the caller's deadline.
  } finally {
    if (claim) {
      try {
        if (sameInode(claim.stat, fs.lstatSync(claim.path, { bigint: true }))) fs.rmdirSync(claim.path);
      } catch {
        // Leave an uncertain claim failclosed; never delete another claimant's files.
      } finally {
        fs.closeSync(claim.fd);
      }
    }
    if (ownerFd !== undefined) fs.closeSync(ownerFd);
    if (directoryFd !== undefined) fs.closeSync(directoryFd);
  }
}

function sameInode(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function noFollowFlag(): number {
  return fs.constants.O_NOFOLLOW ?? 0;
}
