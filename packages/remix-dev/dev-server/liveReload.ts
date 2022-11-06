import exitHook from "exit-hook";
import * as fse from "fs-extra";
import * as path from "path";
import prettyMs from "pretty-ms";
import WebSocket from "ws";

import { type RemixConfig } from "../config";
import * as compiler from "../compiler";

type WatchCallbacks = {
  onRebuildStart?(): void;
  onInitialBuild?(): void;
};

export async function watch(
  config: RemixConfig,
  mode: compiler.CompileOptions["mode"],
  { onInitialBuild, onRebuildStart }: WatchCallbacks = {}
): Promise<void> {
  // console.log(`Watching Remix app in ${mode} mode...`);

  let start = Date.now();

  let wss = new WebSocket.Server({ port: config.devServerPort });
  function broadcast(event: { type: string; [key: string]: any }) {
    setTimeout(() => {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(event));
        }
      });
    }, config.devServerBroadcastDelay);
  }

  function log(message: string) {
    message = `💿 ${message}`;
    console.log(message);
    broadcast({ type: "LOG", message });
  }

  let closeWatcher = await compiler.watch(config, {
    mode,
    onInitialBuild,
    onRebuildStart() {
      onRebuildStart?.();
      log("Rebuilding...");
    },
    onRebuildFinish(durationMs) {
      log(`Rebuilt in ${durationMs}`);
      broadcast({ type: "RELOAD" });
    },
    onFileCreated(file) {
      log(`File created: ${path.relative(process.cwd(), file)}`);
    },
    onFileChanged(file) {
      log(`File changed: ${path.relative(process.cwd(), file)}`);
    },
    onFileDeleted(file) {
      log(`File deleted: ${path.relative(process.cwd(), file)}`);
    },
  });

  console.log(`💿 Built in ${prettyMs(Date.now() - start)}`);

  // TODO channelize
  let resolve: () => void;
  exitHook(() => {
    resolve();
  });
  return new Promise<void>((r) => {
    resolve = r;
  }).then(async () => {
    wss.close();
    await closeWatcher();
    fse.emptyDirSync(config.assetsBuildDirectory);
    fse.rmSync(config.serverBuildPath);
  });
}
