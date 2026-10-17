#!/usr/bin/env node
// everyhook: write a hook once, run it in every coding agent. All the work lives in src/cli.mjs; run `everyhook --help` for the commands.
import { main } from "../src/cli.mjs";

// `everyhook list | head` closes the pipe early: that is not an error.
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

process.exitCode = await main(process.argv.slice(2));
