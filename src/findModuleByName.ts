import _ from 'lodash';
import type { ChildProcess, ExecOptions } from 'node:child_process';
import { exec, spawn } from 'node:child_process';
import notify from 'sd-notify';
import type { Endpoint, MinimalAlphaConfigItem } from './configHelper.js';
import { hasAppEndpoints, isEndpointByApp } from './configHelper.js';
import { log } from './log.js';

export type ExecPromise = Promise<string> & { cp: ChildProcess };

const controller = new AbortController();

// `exec` timeout is in milliseconds. pw-cli/pw-link answer in ~0.1–0.3 s; 2 s leaves room for a busy graph.
const EXEC_TIMEOUT_MS = 2_000;
// `pw-cli list-objects Port` is the largest output (~65 KB with ~200 ports); keep generous headroom.
const EXEC_MAX_BUFFER = 512 * 1024;

export function pmExec(shell: string, options: ExecOptions = {}): ExecPromise {
  let cp: ChildProcess;
  const result = new Promise<string>((resolve, reject) => {
    cp = exec(
      shell,
      { timeout: EXEC_TIMEOUT_MS, maxBuffer: EXEC_MAX_BUFFER, signal: controller.signal, ...options },
      (error, stdout, stderr) => {
        if (error) {
          log(`Error invoking ${shell}: ${stderr}`, 2);
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  }) as ExecPromise;
  result.cp = cp!;
  return result;
}

export interface BaseBlock {
  id: string;
  type: string;

  [key: string]: string | undefined;
}

export interface SimplePortBlock {
  id: string;
  type: string;
  name: string;
  prefix?: string;
  isMonitor?: boolean;
  isPlayback?: boolean;
  isOutput?: boolean;
}

export function extractSimplePort(line: string): SimplePortBlock {
  const [id, ...rest] = line.trim().split(' ');
  const [partName, type] = rest.join(' ').split(':', 2);
  const [prefix, ...name] = partName.split('.');
  const nameWithDots = name.join('.');
  const isPlayback = type ? type.startsWith('playback') : undefined;
  const isOutput = type ? type.startsWith('output') : undefined;
  const isMonitor = type ? type.startsWith('monitor') : undefined;
  return {
    id,
    type,
    name: nameWithDots ? nameWithDots : prefix,
    prefix: nameWithDots ? prefix : undefined,
    isPlayback,
    isOutput,
    isMonitor,
  };
}

export function extractSimplePorts(output: string): SimplePortBlock[] {
  const blocks: SimplePortBlock[] = [];

  for (const line of output.split('\n')) {
    const normalLine = line.trim();
    if (normalLine) {
      blocks.push(extractSimplePort(line));
    }
  }

  return blocks;
}

type LinkBlock = { id: string; from: SimplePortBlock; to: SimplePortBlock };

export function extractSimpleLinks(output: string): Record<string, LinkBlock> {
  const links: Record<string, LinkBlock> = {};

  let group: SimplePortBlock | undefined = undefined;
  for (const wholeLine of output.split('\n')) {
    const line = wholeLine.trim();
    if (!line) {
      continue;
    }
    const linkParseMatch = line.match(/^(\d+)\s+(\|->|\|<-)\s+(\d+.+)$/);
    if (!linkParseMatch) {
      group = extractSimplePort(line);
      continue;
    }
    if (!group) {
      log(`Failed to parse port group before line: ${line}`, 2);
      continue;
    }
    const [_, linkId, linkType, portLine] = linkParseMatch;
    const item = extractSimplePort(portLine);
    const from = linkType === '|<-' ? item : group;
    const to = linkType === '|->' ? item : group;
    links[linkId] = {
      id: linkId,
      from,
      to,
    };
  }

  return links;
}

export function extractNodes(output: string): BaseBlock[] {
  let lastBlock: BaseBlock | null = null;
  const blocks: BaseBlock[] = [];

  for (const line of output.split('\n')) {
    const matchId = line.match(/^\s+id\s(\d+),\s+type\s(.+)/);
    if (matchId) {
      if (lastBlock) blocks.push(lastBlock);
      lastBlock = { id: matchId[1], type: matchId[2] };
      continue;
    }
    if (!line.trim() || !lastBlock) continue;
    const [rawKey, rawVal] = line.split(' = ', 2);
    const key = rawKey.trim();
    const val = rawVal.replace(/^"(.+)"$/, (_m, v) => v);
    lastBlock[key] = val;
  }

  if (lastBlock) blocks.push(lastBlock);
  return blocks;
}

export function extractInfoProperties(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  let inProps = false;
  for (const raw of output.split('\n')) {
    const line = raw.trim().replace(/^\*\s*/, '').trim();
    if (!line) continue;
    if (line === 'properties:') {
      inProps = true;
      continue;
    }
    if (!inProps) continue;
    const eqIdx = line.indexOf(' = ');
    if (eqIdx < 0) {
      // next section (e.g. 'params: (9)')
      inProps = false;
      continue;
    }
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 3).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

/**
 * Native PipeWire clients (pw-play, pw-record, pw-cat, …) keep `application.process.*`
 * only on their Client object; the Node carries just `application.name`/`node.name`.
 * pipewire-pulse clients duplicate them onto the Node. Fill the gaps from the Client
 * without overriding anything the Node already states.
 */
export function mergeClientProps(node: BaseBlock, client: Record<string, string | undefined>): BaseBlock {
  for (const key in client) {
    if (!key.startsWith('application.')) continue;
    if (node[key] === undefined && client[key] !== undefined) {
      node[key] = client[key];
    }
  }
  if (node['application.process.id'] === undefined && client['pipewire.sec.pid'] !== undefined) {
    node['application.process.id'] = client['pipewire.sec.pid'];
  }
  return node;
}

export function findBlockIdBy(blocks: BaseBlock[], field: string, name: string): string | undefined {
  const found = blocks.find((block) => block[field] === name);
  return found?.id;
}

export function filterBlocksBy(blocks: BaseBlock[], field: string, re: RegExp): BaseBlock[] {
  return blocks.filter((block) => block[field]?.match(re));
}

export interface MonBlock {
  _changedType: string | null;
  args?: string;

  [key: string]: string | undefined | null;
}

export function parseMonitoringBlock(text: string): MonBlock {
  const result: MonBlock = { _changedType: null };
  const lines = text.split(/\r?\n/);
  let insideArgs = false;
  let argsBuffer: string[] = [];
  let changedType = '';

  for (let raw of lines) {
    const line = raw.trimEnd();
    if (!changedType) {
      const matchAction = line.match(/^(\w+):\n?$/);
      if (matchAction) {
        changedType = matchAction[1];
        result._changedType = changedType;
        continue;
      } else {
        result._changedType = null;
        changedType = 'unknown';
      }
    }

    if (insideArgs) {
      // Look for the closing brace + quote, e.g.   }"
      if (line.endsWith('}"')) {
        // Capture up to the closing brace
        argsBuffer.push(line.slice(0, -1));
        result.args = argsBuffer.join('\n');
        insideArgs = false;
        argsBuffer = [];
      } else {
        argsBuffer.push(line);
      }
      continue;
    }

    // Split on first colon
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    let val = line.slice(sep + 1).trim();

    if (key === 'args' && val.startsWith('"')) {
      // Strip the opening quote
      val = val.slice(1);
      // If it also ends with a closing quote, single-line
      if (val.endsWith('"')) {
        result.args = val.slice(0, -1).trim();
      } else {
        insideArgs = true;
        argsBuffer.push(val);
      }
    } else {
      // Remove surrounding quotes if they exist
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  }

  return result;
}

let monitorChildProcess: ChildProcess | null = null;

export async function monitor(onBlock: (block: MonBlock) => void): Promise<void> {
  if (monitorChildProcess) {
    throw new Error(`Processing ${monitorChildProcess.spawnargs.join(' ')}: not cleaned`);
  }

  const cp = spawn('pw-mon', ['--no-colors', '--hide-props', '--hide-params', '--print-separator', '\n\n'], {
    shell: false,
    signal: controller.signal,
  });
  monitorChildProcess = cp;

  let stderr = '';
  let buffer = '';
  let exitCalled = false;
  const infinite = new Promise<void>((res, rej) => {
    cp.once('close', (exitCode: number) => {
      exitCalled = true;
      if (exitCode !== 0 || stderr) {
        rej({ exitCode, stderr });
      } else {
        res();
      }
    });
    function onStop(error: Error | number | null | undefined) {
      setTimeout(
        () => {
          if (exitCalled) return;
          if (typeof error === 'number') {
            const exitCode = error;
            if (exitCode !== 0 || stderr) {
              rej({ exitCode, stderr });
            } else {
              res();
            }
          } else if (error instanceof Error) {
            rej({ exitCode: cp.exitCode, stderr, error });
          } else if (cp.exitCode !== 0 || stderr) {
            rej({ exitCode: cp.exitCode, stderr });
          } else {
            res();
          }
          exitCalled = true;
        },
        error instanceof Error ? 10 : 100,
      );
    }
    cp.once('error', onStop);
    cp.once('exit', onStop);
    cp.once('disconnect', onStop);
    cp.once('spawn', notify.ready);
  });

  cp.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  cp.stdout.on('data', (data) => {
    buffer += data.toString();
    const maybeFullBlocks = buffer.split('\n\n');
    while (maybeFullBlocks.length > 1) {
      setTimeout(onBlock, 10, parseMonitoringBlock(maybeFullBlocks.shift()!));
    }
    buffer = maybeFullBlocks[0];
  });

  return infinite;
}

type BaseWatchMetada = { _changedType: 'added' | 'changed' | null; _updatedAt?: Date };
type WatchMetada =
  | ({ module: BaseBlock } & BaseWatchMetada)
  | ({ node: BaseBlock } & BaseWatchMetada)
  | ({ device: BaseBlock } & BaseWatchMetada)
  | ({ simple: SimplePortBlock; port: BaseBlock } & BaseWatchMetada)
  | ({ simpleLink: LinkBlock; fromPort: BaseBlock; toPort: BaseBlock } & BaseWatchMetada)
  | { _changedType: 'added' };

function normalizePortName(simplePort: SimplePortBlock, mode = 'simple' as 'simple' | 'human' | 'machine'): string {
  const { prefix, type, name, id } = simplePort;
  const simple = `${prefix ? prefix + '.' : ''}${name}:${type}`;
  if (mode === 'simple') {
    return simple;
  }
  if (mode === 'human') {
    return id.toString().padStart(3, ' ') + ' ' + simple;
  }
  return id.toString() + ':' + simple;
}

//   | ({ simpleLink: LinkBlock; fromPort: BaseBlock; toPort: BaseBlock } & BaseWatchMetada)
interface InternalToLinkBlock {
  simpleLink: LinkBlock;
  fromPort: BaseBlock;
  toPort: BaseBlock;
  humanName: string;
  humanLinkName: string;
}
interface InternalFromBlock {
  simple: SimplePortBlock;
  port: BaseBlock;
  humanName: string;
}

export interface InternalDiff {
  from: string;
  add: string[];
  rm: string[];
}

/**
 * Several config items may resolve to the same source port (e.g. an id-based entry and an
 * app-based entry for the same stream). Merge them so each port gets one batch:
 * - add: union (a duplicate `pw-link` fails with "File exists" and aborts the batch);
 * - rm: intersection — an existing link is dropped only if no entry wants it. An entry that
 *   refused to remove anything (empty rm) therefore blocks removals for that port.
 */
export function mergeDiffs(diffs: InternalDiff[]): InternalDiff[] {
  const byFrom = new Map<string, InternalDiff>();
  for (const d of diffs) {
    const prev = byFrom.get(d.from);
    if (!prev) {
      byFrom.set(d.from, { from: d.from, add: Array.from(new Set(d.add)), rm: Array.from(new Set(d.rm)) });
      continue;
    }
    prev.add = Array.from(new Set([...prev.add, ...d.add]));
    const rm = new Set(d.rm);
    prev.rm = prev.rm.filter((r) => rm.has(r));
  }
  return Array.from(byFrom.values());
}

export function resolveEndpoint(
  endpoint: Endpoint,
  watchedObjects: Record<string, WatchMetada>,
): string | undefined {
  if (!isEndpointByApp(endpoint)) {
    return endpoint.findByid;
  }
  const { findByApp, portKind, channel } = endpoint;
  if (findByApp.binName === undefined && findByApp.pid === undefined) {
    log(`findByApp requires binName or pid: ${JSON.stringify(findByApp)}`, 3);
    return undefined;
  }
  const matchingNodeIds: string[] = [];
  for (const id in watchedObjects) {
    const meta = watchedObjects[id];
    if (!('node' in meta)) continue;
    const node = meta.node;
    if (findByApp.binName !== undefined) {
      const candidates = [
        node['application.process.binary'],
        node['application.name'],
        node['node.name'],
      ];
      if (!candidates.includes(findByApp.binName)) continue;
    }
    if (findByApp.pid !== undefined) {
      if (node['application.process.id'] !== String(findByApp.pid)) continue;
    }
    matchingNodeIds.push(node.id);
  }
  if (matchingNodeIds.length === 0) {
    log(`no node matched for app ${JSON.stringify(findByApp)}`, 1);
    return undefined;
  }
  // One process may own several nodes (e.g. paplay + parec are both `pacat`,
  // pw-play + pw-record are both `pw-cat`). Only nodes that actually expose
  // the wanted port are real candidates.
  const wantedSuffix = `${portKind}_${channel}`;
  const nodeIdSet = new Set(matchingNodeIds);
  const portsByNode = new Map<string, string>();
  for (const id in watchedObjects) {
    const meta = watchedObjects[id];
    if (!('port' in meta) || !meta.simple) continue;
    const nodeId = meta.port['node.id'];
    if (!nodeId || !nodeIdSet.has(nodeId)) continue;
    if (meta.simple.type === wantedSuffix) {
      portsByNode.set(nodeId, normalizePortName(meta.simple, 'simple'));
    }
  }
  if (portsByNode.size === 0) {
    log(`no port ${wantedSuffix} on nodes ${matchingNodeIds.join(',')} for app ${JSON.stringify(findByApp)}`, 1);
    return undefined;
  }
  if (portsByNode.size > 1) {
    log(
      `ambiguous app match for ${JSON.stringify(findByApp)}: nodes ${Array.from(portsByNode.keys()).join(',')}`,
      3,
    );
    return undefined;
  }
  return portsByNode.values().next().value;
}

async function watchChanges(stickConfig: MinimalAlphaConfigItem[], watchedObjects: Record<string, WatchMetada>) {
  const currentAllLinks: Record<
    string,
    {
      from: InternalFromBlock;
      to: Set<InternalToLinkBlock>;
    }
  > = {};

  for (const id in watchedObjects) {
    const meta = watchedObjects[id];
    if (!('port' in meta)) {
      continue;
    }
    const simpleName = normalizePortName(meta.simple, 'simple');
    currentAllLinks[simpleName] = currentAllLinks[simpleName] || {};
    currentAllLinks[simpleName].from = meta satisfies Omit<
      InternalFromBlock,
      'humanName'
    > as object as InternalFromBlock;
    currentAllLinks[simpleName].from.humanName = normalizePortName(meta.simple, 'human');
    currentAllLinks[simpleName].to = currentAllLinks[simpleName].to || new Set<InternalToLinkBlock>();
  }
  for (const id in watchedObjects) {
    const meta = watchedObjects[id];
    if (!('simpleLink' in meta)) {
      continue;
    }
    const fromSimpleName = normalizePortName(meta.simpleLink.from, 'simple');
    const humanName = normalizePortName(meta.simpleLink.to, 'human');
    const humanLinkName = id.padStart(3, ' ') + '  |-> ' + humanName;
    const currentLink = currentAllLinks[fromSimpleName];
    const to = meta satisfies Omit<InternalToLinkBlock, 'humanName' | 'humanLinkName'> as object as InternalToLinkBlock;
    to.humanName = humanName;
    to.humanLinkName = humanLinkName;
    currentLink.to.add(to);
  }
  const debugArraay = Object.values(currentAllLinks);
  debugArraay.sort((a, b) => a.from.humanName.localeCompare(b.from.humanName));
  const toLines = debugArraay.map(
    ({ from, to }) =>
      from.humanName +
      '\n' +
      Array.from(to)
        .map((o) => o.humanLinkName)
        .sort()
        .join('\n'),
  );
  const diffs = [] as InternalDiff[];
  for (const config of stickConfig) {
    const fromName = resolveEndpoint(config, watchedObjects);
    if (!fromName) {
      continue;
    }
    const portLinks = currentAllLinks[fromName];
    if (!portLinks) {
      log(`port not found. skip diff, port: ${fromName}`, 1);
      continue;
    }
    if (config.ignoreMonitors) {
      for (const link of portLinks.to) {
        if (link.simpleLink.to.isMonitor === true) {
          portLinks.to.delete(link);
        }
      }
    }
    if (config.ignore && config.ignore['object.path'] && config.ignore['object.path'].match) {
      const { match } = config.ignore['object.path'];
      for (const link of portLinks.to) {
        const objectPath = link.toPort['object.path'];
        if (!objectPath) {
          continue;
        }
        // todo AND filter
        if (objectPath.match(match)) {
          portLinks.to.delete(link);
        }
      }
    }
    const currentDiff = {
      from: normalizePortName(portLinks.from.simple, 'machine'),
      add: [],
      rm: [],
    } as InternalDiff;
    diffs.push(currentDiff);
    const resolvedStickTo = config.stickTo.map((c) => resolveEndpoint(c, watchedObjects));
    const stickToSimpleNames = new Set(resolvedStickTo.filter((n): n is string => !!n));
    // to remove
    for (const to of portLinks.to) {
      if (!stickToSimpleNames.has(normalizePortName(to.simpleLink.to, 'simple'))) {
        currentDiff.rm.push(normalizePortName(to.simpleLink.to, 'machine'));
      }
    }
    // to add
    for (const findByid of resolvedStickTo) {
      if (!findByid) {
        // unresolved endpoint — don't risk removing valid links
        currentDiff.rm = [];
        continue;
      }
      let existTo = false;
      for (const to of portLinks.to) {
        if (normalizePortName(to.simpleLink.to, 'simple') === findByid) {
          existTo = true;
          break;
        }
      }
      if (existTo) {
        continue;
      }
      const portMeta = Object.values(watchedObjects).find(
        (o) => 'port' in o && o.simple && normalizePortName(o.simple, 'simple') === findByid,
      ) as { simple: SimplePortBlock } | undefined;
      if (!portMeta) {
        log(`port to add not found. not going to remove anythin, port: ${fromName} , to port: ${findByid}.`, 1);
        currentDiff.rm = [];
        continue;
      }
      currentDiff.add.push(normalizePortName(portMeta.simple, 'machine'));
    }
  }
  const filteredDiffs = mergeDiffs(diffs).filter((d) => d.add.length > 0 || d.rm.length > 0);
  if (filteredDiffs.length > 0) {
    // log('current links:\n' + toLines.join('\n'), 0);
    log('diff to apply:\n' + JSON.stringify(filteredDiffs, null, 2), 0);
  }

  for (const diffBatch of filteredDiffs) {
    try {
      await Promise.all(
        diffBatch.add.map((second) => pmExec(`pw-link --passive --wait --verbose "${diffBatch.from}" "${second}"`)),
      );
      await Promise.all(
        diffBatch.rm.map((second) => pmExec(`pw-link --wait -d --verbose "${diffBatch.from}" "${second}"`)),
      );
    } catch (e) {
      log(e as Error, 1);
    }
  }
}

/**
 * `pw-cli list-objects` prints only registry (global) properties. Application identity
 * (`application.process.binary`, `application.process.id`, …) is only available via
 * `pw-cli info`, on the Node for pipewire-pulse clients and on the Client for native ones.
 */
async function enrichStreamNodes(nodes: BaseBlock[]): Promise<void> {
  const streamNodes = nodes.filter((n) => n['media.class']?.startsWith('Stream/'));
  const infoOf = (id: string) =>
    pmExec(`pw-cli info ${id}`).then(
      (out) => extractInfoProperties(out),
      (err) => {
        log(`Failed to enrich object ${id}: ${(err as Error).message}`, 1);
        return null;
      },
    );
  const nodeProps = await Promise.all(streamNodes.map((n) => infoOf(n.id)));
  const clientIds = new Set<string>();
  streamNodes.forEach((node, i) => {
    const props = nodeProps[i];
    if (props) Object.assign(node, props);
    if (node['client.id']) clientIds.add(node['client.id']);
  });
  const clientList = Array.from(clientIds);
  const clientProps = await Promise.all(clientList.map(infoOf));
  const clients = new Map<string, Record<string, string>>();
  clientList.forEach((id, i) => {
    if (clientProps[i]) clients.set(id, clientProps[i]!);
  });
  for (const node of streamNodes) {
    const client = node['client.id'] ? clients.get(node['client.id']) : undefined;
    if (client) mergeClientProps(node, client);
  }
}

async function startInternal(stickConfig: MinimalAlphaConfigItem[]) {
  const watchedObjects: Record<string, WatchMetada> = {};
  async function processBatch(changedBatch: MonBlock[]) {
    if (!changedBatch.length) return;
    for (let monBlock of changedBatch) {
      if (!monBlock._changedType || !monBlock.id) continue;
      if ('added' === monBlock._changedType) {
        watchedObjects[monBlock.id] = watchedObjects[monBlock.id] || { _changedType: 'added' };
      } else if ('changed' === monBlock._changedType) {
        if (monBlock.id in watchedObjects) {
          watchedObjects[monBlock.id]._changedType = 'changed';
        } else {
          watchedObjects[monBlock.id] = { _changedType: 'added' };
        }
      } else if ('removed' === monBlock._changedType) {
        delete watchedObjects[monBlock.id];
      }
    }

    const [outputNodes, outputPorts, outputSimplePorts, outputSimpleLinks, outputDevice, outputModules] =
      await Promise.all([
        pmExec('pw-cli list-objects Node'),
        pmExec('pw-cli list-objects Port'),
        pmExec('pw-link --output --input --id'),
        pmExec('pw-link --links --id'),
        pmExec('pw-cli list-objects Device'),
        pmExec('pw-cli list-objects Module'),
      ]);

    const modules = extractNodes(outputModules);
    for (const module of modules) {
      watchedObjects[module.id] = { _changedType: null, _updatedAt: new Date(), module };
    }
    const devices = extractNodes(outputDevice);
    for (const device of devices) {
      watchedObjects[device.id] = { _changedType: null, _updatedAt: new Date(), device };
    }
    const nodes = extractNodes(outputNodes);
    if (hasAppEndpoints(stickConfig)) {
      await enrichStreamNodes(nodes);
    }
    for (const node of nodes) {
      watchedObjects[node.id] = { _changedType: null, _updatedAt: new Date(), node };
    }
    const ports = extractNodes(outputPorts);
    const simplePorts = extractSimplePorts(outputSimplePorts);
    for (const port of ports) {
      watchedObjects[port.id] = {
        _changedType: null,
        _updatedAt: new Date(),
        port,
        simple: simplePorts.find(({ id }) => id === port.id)!,
      };
    }
    const simpleLinks = extractSimpleLinks(outputSimpleLinks);
    for (const linkId in simpleLinks) {
      const link = simpleLinks[linkId];
      watchedObjects[link.id] = {
        _changedType: null,
        _updatedAt: new Date(),
        simpleLink: link,
        toPort: (watchedObjects[link.to.id] as { port: BaseBlock }).port,
        fromPort: (watchedObjects[link.from.id] as { port: BaseBlock }).port,
      };
    }
    await watchChanges(stickConfig, watchedObjects);
  }

  let lastRunProcessBatch = Promise.resolve();
  let newBatch: MonBlock[] = [];
  let lastBatch: MonBlock[] = [];

  async function sequenceProcessBatch() {
    await lastRunProcessBatch;
    lastBatch = newBatch;
    newBatch = [];
    lastRunProcessBatch = processBatch(lastBatch).catch((error) => {
      log(error as Error, 2);
      newBatch = lastBatch.concat(newBatch);
    });
  }

  const debouncedProcessBatch = _.debounce(sequenceProcessBatch, 1000);
  const pingAlive = _.throttle(() => log('Alive', 0), 60000);

  await monitor((monBlock) => {
    newBatch.push(monBlock);
    debouncedProcessBatch();
    pingAlive();
  });
}

export default function start(stickConfig: MinimalAlphaConfigItem[]) {
  function onExit() {
    log('Exiting...', 0);
    controller.abort('exiting');
  }
  process.on('SIGINT', onExit);
  process.on('SIGTERM', onExit);

  return startInternal(stickConfig).then(
    () => {
      log('Shutdown complete.', 1);
      process.exit(0);
    },
    (err) => {
      // If it was the user-initiated shutdown, exit cleanly:
      if (err && err.name === 'AbortError') {
        log('Shutdown complete.', 1);
        process.exit(0);
      }
      // Otherwise it’s some other failure—rethrow / crash:
      log(err, 3);
      process.exit(1);
    },
  );
}
