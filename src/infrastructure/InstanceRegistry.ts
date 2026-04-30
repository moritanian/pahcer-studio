import * as fs from 'fs';
import * as path from 'path';
import { getUserDataDir } from './userPaths';

export interface InstanceInfo {
  pid: number;
  port: number;
  host: string;
  startedAt: string;
}

export function getInstanceRegistryPath(): string {
  return path.join(getUserDataDir(), 'instance.json');
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the running pahcer-studio instance from the registry.
 * Auto-removes a stale registry whose PID is gone.
 */
export function readInstance(): InstanceInfo | null {
  const p = getInstanceRegistryPath();
  if (!fs.existsSync(p)) return null;
  try {
    const info = JSON.parse(fs.readFileSync(p, 'utf-8')) as InstanceInfo;
    if (
      typeof info.pid !== 'number' ||
      typeof info.port !== 'number' ||
      typeof info.host !== 'string'
    ) {
      try {
        fs.unlinkSync(p);
      } catch {
        // ignore
      }
      return null;
    }
    if (!isProcessAlive(info.pid)) {
      try {
        fs.unlinkSync(p);
      } catch {
        // ignore
      }
      return null;
    }
    return info;
  } catch {
    return null;
  }
}

export function writeInstance(info: InstanceInfo): void {
  const p = getInstanceRegistryPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(info, null, 2));
}

export function clearInstance(): void {
  const p = getInstanceRegistryPath();
  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
    } catch {
      // ignore
    }
  }
}
