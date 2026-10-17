// The only code that writes. An agent's configuration file is the user's: a write that changes one backs it up first (next to it, named
// <file>.bak-everyhook-<timestamp>), goes through a temporary file and a rename so that nobody sees half of it, keeps the file's mode,
// and follows a symlink to the file instead of replacing the link. A file that is not there yet has nothing to back up.
// The model is claude-settings-doctor's src/write.mjs.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// The file operations that matter, in one place. Tests swap them to make a rename fail.
export const ops = { rename: (from, to) => fs.renameSync(from, to) };

export const BACKUP_MARK = ".bak-everyhook-";

const two = (n) => String(n).padStart(2, "0");
const exists = (p) => { try { fs.statSync(p); return true; } catch { return false; } };

/** 20261017-153012 in local time, used in backup names. */
export function stamp(d = new Date()) {
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

/** <file>.bak-everyhook-<timestamp>, or with -1, -2 ... when that name is taken. */
export function backupPath(file, now = new Date()) {
  const base = `${file}${BACKUP_MARK}${stamp(now)}`;
  if (!exists(base)) return base;
  for (let i = 1; i < 1000; i++) if (!exists(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

/** The names of the backups of a file, oldest first. */
export function listBackups(file) {
  const prefix = `${path.basename(file)}${BACKUP_MARK}`;
  try {
    return fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith(prefix)).sort((a, b) => {
      const [sa, na = "0"] = a.slice(prefix.length).split(/-(?=\d+$)/);
      const [sb, nb = "0"] = b.slice(prefix.length).split(/-(?=\d+$)/);
      return sa < sb ? -1 : sa > sb ? 1 : Number(na) - Number(nb);
    });
  } catch { return []; }
}

/** Where the bytes of a file really are: a symlink is followed, so the link stays a link. */
function realTarget(file) {
  try { return fs.realpathSync(file); } catch { return file; }
}

/**
 * Write bytes (a string or a buffer) to a file through a temporary file in the same folder and a rename. The mode of an existing file is
 * kept. When the rename cannot be done (a mount point, another volume: EXDEV, EBUSY, EPERM), the file is written in place instead.
 */
export function writeAtomic(file, data) {
  const target = realTarget(file);
  let mode = null;
  try { mode = fs.statSync(target).mode & 0o777; } catch { /* a new file */ }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
  fs.writeFileSync(tmp, data);
  if (mode !== null) { try { fs.chmodSync(tmp, mode); } catch { /* the file system has no modes */ } }
  try {
    ops.rename(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    if (!e || !["EXDEV", "EBUSY", "EPERM", "EACCES"].includes(e.code)) throw e;
    fs.writeFileSync(target, data);
  }
}

/** Copy a file to its backup name. Returns the backup's path. */
export function backupFile(file, now = new Date()) {
  const to = backupPath(file, now);
  fs.copyFileSync(realTarget(file), to);
  return to;
}

/** Remove a file that everyhook made (a hooks file with nothing left in it). */
export function removeFile(file) {
  fs.rmSync(realTarget(file), { force: true });
}

/**
 * Put the bytes of the newest backup of a file back. The file as it is now is backed up first, so this can be undone too.
 * Returns { restored, path, from, savedCurrent, others } or { restored: false, reason }.
 */
export function restoreBackup(file, { now = new Date(), dryRun = false } = {}) {
  const names = listBackups(file);
  if (!names.length) return { restored: false, path: file, reason: `there is no backup of it (they are named <file>${BACKUP_MARK}<timestamp>)` };
  const from = path.join(path.dirname(file), names[names.length - 1]);
  const result = { restored: !dryRun, path: file, from, savedCurrent: null, others: names.length - 1, dryRun };
  if (dryRun) return result;
  if (exists(file)) result.savedCurrent = backupFile(file, now);
  writeAtomic(file, fs.readFileSync(from));
  return result;
}
