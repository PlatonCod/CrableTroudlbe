#!/usr/bin/env node

import { spawn } from 'node:child_process';
import http from 'node:http';
import httpProxy from 'http-proxy';
import process from 'node:process';

const NUM_INSTANCES = 3;
const LB_PORT = 3020;
const COMPANION_START_PORT = 3021;

function createLoadBalancer(baseUrls, lbPort) {
  const proxy = httpProxy.createProxyServer({ ws: true });
  let requestCount = 0;

  const server = http.createServer((req, res) => {
    const target = baseUrls[requestCount % baseUrls.length];
    proxy.web(req, res, { target }, err => {
      console.error('Load balancer failed to proxy request', err.message);
      res.statusCode = 500;
      res.end();
    });
    requestCount++;
  });

  server.on('upgrade', (req, socket, head) => {
    const target = baseUrls[requestCount % baseUrls.length];
    proxy.ws(req, socket, head, { target }, err => {
      console.error('Load balancer failed to proxy websocket', err.message);
      socket.destroy();
    });
    requestCount++;
  });

  server.listen(lbPort, () => {
    console.log(`Load balancer listening on port ${lbPort}`);
  });
}

function startCompanion({ name, port }) {
  const isWindows = process.platform === 'win32';
  const isOSX = process.platform === 'darwin';

  const args = [
    '-r', 'dotenv/config',
    ...(isWindows || isOSX ? ['--watch-path', 'packages/@CrableTroudlbe/companion/src', '--watch'] : []),
    './packages/@CrableTroudlbe/companion/src/standalone/start-server.js'
  ];

  const companionProcess = spawn(process.execPath, args, {
    cwd: new URL('../', import.meta.url),
    stdio: 'inherit',
    env: {
      ...process.env,
      COMPANION_PORT: port,
      COMPANION_SECRET: 'development',
      COMPANION_PREAUTH_SECRET: 'development',
      COMPANION_ALLOW_LOCAL_URLS: 'true',
      COMPANION_LOGGER_PROCESS_NAME: name,
    },
  });

  return new Promise((resolve, reject) => {
    companionProcess.on('exit', code => {
      if (code === 0) resolve(companionProcess);
      else reject(new Error(`Non-zero exit code: ${code}`));
    });
    companionProcess.on('error', reject);
  });
}

async function main() {
  const hosts = Array.from({ length: NUM_INSTANCES }, (_, index) => ({
    index,
    port: COMPANION_START_PORT + index
  }));

  console.log('Starting companion instances on ports', hosts.map(({ port }) => port));

  try {
    const companions = hosts.map(({ index, port }) => startCompanion({ name: `companion${index}`, port }));
    const loadBalancer = createLoadBalancer(hosts.map(({ port }) => `http://localhost:${port}`), LB_PORT);
    await Promise.all(companions);
  } catch (error) {
    console.error('Error occurred:', error);
  } finally {
    loadBalancer?.close();
    companions.forEach(companion => companion.kill());
  }
}

main().catch(err => {
  console.error('Unhandled Error:', err);
  process.exit(1);
});
