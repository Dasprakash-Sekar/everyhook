// The only code that writes: a backup next to the file before it changes, a write through a temporary file, a symlink followed, and
// restore putting the newest backup back (saving what was there first).
import { tmpDir, IS_WIN } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BACKUP_MARK, backupFile, backupPath, listBackups, ops, removeFile, restoreBackup, stamp, writeAtomic } from "../src/write.mjs";

const NOW = new Date(2026, 9, 17, 15, 30, 12);

test("stamp: local time, sortable", () => {
  assert.equal(stamp(NOW), "20261017-153012");
});

test("backupPath: <file>.bak-everyhook-<stamp>, then -1, -2 when the name is taken", () => {
  const dir = tmpDir("eh-wr-");
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, "a");
  assert.equal(path.basename(backupPath(file, NOW)), `settings.json${BACKUP_MARK}20261017-153012`);
  fs.writeFileSync(backupPath(file, NOW), "x");
  assert.equal(path.basename(backupPath(file, NOW)), `settings.json${BACKUP_MARK}20261017-153012-1`);
  fs.writeFileSync(`${file}${BACKUP_MARK}20261017-153012-1`, "x");
  assert.equal(path.basename(backupPath(file, NOW)), `settings.json${BACKUP_MARK}20261017-153012-2`);
});

test("listBackups: oldest first, the -n suffix as a number, other files and other tools' backups left out", () => {
  const dir = tmpDir("eh-wr-");
  const file = path.join(dir, "s.json");
  for (const n of ["s.json.bak-everyhook-20261017-153012-10", "s.json.bak-everyhook-20261017-153012-2", "s.json.bak-everyhook-20261017-153012", "s.json.bak-everyhook-20261016-000000", "s.json.bak-settings-doctor-20261017-153012", "other.json.bak-everyhook-20261017-153012", "s.json"]) fs.writeFileSync(path.join(dir, n), "");
  assert.deepEqual(listBackups(file), ["s.json.bak-everyhook-20261016-000000", "s.json.bak-everyhook-20261017-153012", "s.json.bak-everyhook-20261017-153012-2", "s.json.bak-everyhook-20261017-153012-10"]);
  assert.deepEqual(listBackups(path.join(dir, "missing", "x.json")), []);
});

test("writeAtomic: writes, makes the folder, keeps the mode of an existing file, leaves no temporary file", () => {
  const dir = tmpDir("eh-wr-");
  const file = path.join(dir, "a", "b", "c.json");
  writeAtomic(file, "one");
  assert.equal(fs.readFileSync(file, "utf8"), "one");
  if (!IS_WIN) { fs.chmodSync(file, 0o600); writeAtomic(file, "two"); assert.equal(fs.statSync(file).mode & 0o777, 0o600); }
  writeAtomic(file, Buffer.from([1, 2, 3]));
  assert.deepEqual([...fs.readFileSync(file)], [1, 2, 3]);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["c.json"]);
});

test("writeAtomic: when the rename cannot be done it writes in place; another error is raised and nothing is left behind", () => {
  const dir = tmpDir("eh-wr-");
  const file = path.join(dir, "f.json");
  fs.writeFileSync(file, "old");
  const real = ops.rename;
  try {
    ops.rename = () => { const e = new Error("busy"); e.code = "EBUSY"; throw e; };
    writeAtomic(file, "new");
    assert.equal(fs.readFileSync(file, "utf8"), "new");
    ops.rename = () => { const e = new Error("nope"); e.code = "ENOSPC"; throw e; };
    assert.throws(() => writeAtomic(file, "newer"), /nope/);
    assert.equal(fs.readFileSync(file, "utf8"), "new");
    assert.deepEqual(fs.readdirSync(dir), ["f.json"], "the temporary file is removed");
  } finally { ops.rename = real; }
});

test("writeAtomic follows a symlink instead of replacing the link", { skip: IS_WIN && "creating a symlink needs a privilege on Windows" }, () => {
  const dir = tmpDir("eh-wr-");
  const target = path.join(dir, "real.json");
  const link = path.join(dir, "link.json");
  fs.writeFileSync(target, "old");
  fs.symlinkSync(target, link);
  writeAtomic(link, "new");
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.readFileSync(target, "utf8"), "new");
});

test("backupFile copies the bytes (also a file that is not text); removeFile removes", () => {
  const dir = tmpDir("eh-wr-");
  const file = path.join(dir, "s.json");
  fs.writeFileSync(file, Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d, 0x0d, 0x0a]));
  const b = backupFile(file, NOW);
  assert.deepEqual([...fs.readFileSync(b)], [0xef, 0xbb, 0xbf, 0x7b, 0x7d, 0x0d, 0x0a]);
  removeFile(file);
  assert.equal(fs.existsSync(file), false);
  removeFile(file); // nothing there: not an error
});

test("restoreBackup: the newest backup comes back, and the file as it was is saved first", () => {
  const dir = tmpDir("eh-wr-");
  const file = path.join(dir, "s.json");
  fs.writeFileSync(file, "v1");
  backupFile(file, new Date(2026, 9, 17, 10, 0, 0));
  fs.writeFileSync(file, "v2");
  backupFile(file, new Date(2026, 9, 17, 11, 0, 0));
  fs.writeFileSync(file, "v3");
  const dry = restoreBackup(file, { dryRun: true });
  assert.equal(dry.restored, false);
  assert.equal(fs.readFileSync(file, "utf8"), "v3", "a dry run changes nothing");
  assert.equal(path.basename(dry.from), `s.json${BACKUP_MARK}20261017-110000`);
  const r = restoreBackup(file, { now: new Date(2026, 9, 17, 12, 0, 0) });
  assert.equal(r.restored, true);
  assert.equal(fs.readFileSync(file, "utf8"), "v2");
  assert.equal(r.others, 1);
  assert.equal(fs.readFileSync(r.savedCurrent, "utf8"), "v3");
  assert.equal(restoreBackup(path.join(dir, "none.json")).restored, false);
  assert.match(restoreBackup(path.join(dir, "none.json")).reason, /no backup/);
});

test("restoreBackup brings a file back that was deleted", () => {
  const dir = tmpDir("eh-wr-");
  const file = path.join(dir, "s.json");
  fs.writeFileSync(file, "keep");
  backupFile(file, NOW);
  removeFile(file);
  const r = restoreBackup(file);
  assert.equal(r.restored, true);
  assert.equal(r.savedCurrent, null);
  assert.equal(fs.readFileSync(file, "utf8"), "keep");
});
