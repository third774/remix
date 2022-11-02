import type * as Express from "express";
import getPort, { makeRange } from "get-port";
import { type Server } from "http";
import os from "os";
import { type createApp as createAppType } from "@remix-run/serve";

import { readConfig } from "../config";
import * as compiler from "../compiler";
import { loadEnv } from "../env";
import { watch } from "./liveReload";

export async function dev(
  remixRoot: string,
  modeArg?: string,
  portArg?: number
) {
  let createApp: typeof createAppType;
  let express: typeof Express;
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    let serve = require("@remix-run/serve");
    createApp = serve.createApp;
    express = require("express");
  } catch (err) {
    throw new Error(
      "Could not locate @remix-run/serve. Please verify you have it installed " +
        "to use the dev command."
    );
  }

  let config = await readConfig(remixRoot);
  let mode = compiler.parseMode(modeArg ?? "", "development");

  await loadEnv(config.rootDirectory);

  let port = await getPort({
    port: portArg
      ? Number(portArg)
      : process.env.PORT
      ? Number(process.env.PORT)
      : makeRange(3000, 3100),
  });

  if (config.serverEntryPoint) {
    throw new Error("remix dev is not supported for custom servers.");
  }

  let app = express();
  app.disable("x-powered-by");
  app.use((_, __, next) => {
    purgeAppRequireCache(config.serverBuildPath);
    next();
  });
  app.use(
    createApp(
      config.serverBuildPath,
      mode,
      config.publicPath,
      config.assetsBuildDirectory
    )
  );

  let server: Server | null = null;

  try {
    await watch(config, mode, {
      onInitialBuild: () => {
        let onListen = () => {
          let address =
            process.env.HOST ||
            Object.values(os.networkInterfaces())
              .flat()
              .find((ip) => String(ip?.family).includes("4") && !ip?.internal)
              ?.address;

          if (!address) {
            console.log(`Remix App Server started at http://localhost:${port}`);
          } else {
            console.log(
              `Remix App Server started at http://localhost:${port} (http://${address}:${port})`
            );
          }
        };

        server = process.env.HOST
          ? app.listen(port, process.env.HOST, onListen)
          : app.listen(port, onListen);
      },
    });
  } finally {
    server!?.close();
  }
}

function purgeAppRequireCache(buildPath: string) {
  for (let key in require.cache) {
    if (key.startsWith(buildPath)) {
      delete require.cache[key];
    }
  }
}
