import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { ArtifactMetadata, StorageConnector } from './storage-connector';

function toPath(uriOrPath: string): string {
  if (uriOrPath.startsWith('file://')) return fileURLToPath(uriOrPath);
  return resolve(uriOrPath);
}

function toUri(path: string): string {
  return pathToFileURL(resolve(path)).toString();
}

async function metadata(path: string): Promise<ArtifactMetadata> {
  const info = await stat(path);
  return {
    uri: toUri(path),
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
    contentType: path.endsWith('.json') ? 'application/json' : 'text/plain'
  };
}

export class FileStorageConnector implements StorageConnector {
  readonly scheme = 'file';

  async readArtifact(uri: string): Promise<{ uri: string; text: string; metadata: ArtifactMetadata }> {
    const path = toPath(uri);
    return { uri: toUri(path), text: await readFile(path, 'utf8'), metadata: await metadata(path) };
  }

  async writeArtifact(uri: string, text: string): Promise<ArtifactMetadata> {
    const path = toPath(uri);
    await writeFile(path, text);
    return metadata(path);
  }

  async getMetadata(uri: string): Promise<ArtifactMetadata> {
    return metadata(toPath(uri));
  }

  async listArtifacts(uri: string): Promise<ArtifactMetadata[]> {
    const path = toPath(uri);
    const entries = await readdir(path);
    const jsonEntries = entries.filter((entry) => entry.endsWith('.json'));
    return Promise.all(jsonEntries.map((entry) => metadata(join(path, entry))));
  }
}
