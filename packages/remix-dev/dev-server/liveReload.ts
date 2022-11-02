import exitHook from "exit-hook";
import * as fse from "fs-extra";
import * as path from "path";
import prettyMs from "pretty-ms";
import WebSocket from "ws";

import { type RemixConfig, readConfig } from "../config";
import * as compiler from "../compiler";

type WatchCallbacks = {
  onRebuildStart?(): void;
  onInitialBuild?(): void;
};

export async function watch(
  remixRootOrConfig: string | RemixConfig,
  modeArg?: string,
  callbacks?: WatchCallbacks
): Promise<void> {
  let { onInitialBuild, onRebuildStart } = callbacks || {};
  let mode = compiler.parseMode(modeArg ?? "", "development");
  console.log(`Watching Remix app in ${mode} mode...`);

  let start = Date.now();
  let config =
    typeof remixRootOrConfig === "object"
      ? remixRootOrConfig
      : await readConfig(remixRootOrConfig);

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

  function log(_message: string) {
    let message = `💿 ${_message}`;
    console.log(message);
    broadcast({ type: "LOG", message });
  }

  let closeWatcher = await compiler.watch(config, {
    mode,
    onInitialBuild,
    onRebuildStart() {
      start = Date.now();
      onRebuildStart?.();
      log("Rebuilding...");
    },
    onRebuildFinish() {
      log(`Rebuilt in ${prettyMs(Date.now() - start)}`);
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
