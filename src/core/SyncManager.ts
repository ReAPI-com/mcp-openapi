import fs from "fs/promises";
import path from "path";
import {
  ISyncManager,
  SpecSource,
  SyncConfig,
  SyncResult,
  UrlAuth,
} from "./interfaces/ISyncManager";

export class SyncManager implements ISyncManager {
  constructor(private readonly targetDirectory: string) {}

  async sync(config: SyncConfig): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    // Ensure target directory exists
    await fs.mkdir(this.targetDirectory, { recursive: true });

    // Check for duplicate specIds
    const specIds = new Set<string>();
    for (const source of config.sources) {
      if (specIds.has(source.specId)) {
        console.error(`Duplicate specId found: ${source.specId}`);
      }
      specIds.add(source.specId);
    }

    for (const source of config.sources) {
      try {
        const result = await this.copyFromSource(source, this.targetDirectory);
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          timestamp: new Date(),
          filename: this.getFilenameFromSource(source),
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    return results;
  }

  private getFilenameFromSource(source: SpecSource): string {
    // Determine file extension based on the source content
    const extension = source.type === "file" && path.extname(source.path).toLowerCase() === ".json" ? ".json" : ".yaml";
    return `${source.specId}${extension}`;
  }

  private async copyFromSource(
    source: SpecSource,
    targetDir: string
  ): Promise<SyncResult> {
    const filename = this.getFilenameFromSource(source);
    const targetPath = path.join(targetDir, filename);

    if (source.type === "file") {
      await fs.copyFile(source.path, targetPath);
      return {
        success: true,
        timestamp: new Date(),
        filename,
      };
    } else {
      const { headers, url } = this.prepareRequest(source.url, source.auth);
      const response = await fetch(url, { headers });

      if (!response.ok) {
        throw new Error(`Failed to fetch from URL: ${response.statusText}`);
      }

      const content = await response.text();
      await fs.writeFile(targetPath, content, "utf-8");

      return {
        success: true,
        timestamp: new Date(),
        filename,
      };
    }
  }

  prepareRequest(sourceUrl: string, auth?: UrlAuth): { headers: Record<string, string>; url: string } {
    const headers: Record<string, string> = {};
    let url = sourceUrl;

    if (!auth) {
      return { headers, url };
    }

    switch (auth.type) {
      case "bearer": {
        const token = this.resolveEnvValue(auth.value as string);
        headers["Authorization"] = `Bearer ${token}`;
        break;
      }
      case "basic": {
        const { username, password } = auth.value as {
          username: string;
          password: string;
        };
        const resolvedUsername = this.resolveEnvValue(username);
        const resolvedPassword = this.resolveEnvValue(password);
        const token = Buffer.from(`${resolvedUsername}:${resolvedPassword}`).toString("base64");
        headers["Authorization"] = `Basic ${token}`;
        break;
      }
      case "custom": {
        const { name, value } = auth.value as { name: string; value: string };
        const resolvedValue = this.resolveEnvValue(value);
        
        if (auth.position === "query") {
          const urlObj = new URL(url);
          urlObj.searchParams.set(name, resolvedValue);
          url = urlObj.toString();
        } else {
          // Default to header if position is not specified
          headers[name] = resolvedValue;
        }
        break;
      }
    }

    return { headers, url };
  }

  private resolveEnvValue(value: string): string {
    if (!value.match(/^{{.*}}$/)) {
      return value;
    }

    const envKey = value.slice(2, -2); // Remove {{ and }}
    const envValue = process.env[envKey];

    if (!envValue) {
      throw new Error(`Environment variable ${envKey} not found`);
    }

    return envValue;
  }
}
