import fs from "fs/promises";
import Fuse from "fuse.js";
import { OpenAPIV3 } from "openapi-types";
import path from "path";
import { SimpleCache } from "./Cache";
import { ConsoleLogger, Logger } from "./Logger";
import { SyncManager } from "./SyncManager";
import { ISpecScanner } from "./interfaces/ISpecScanner";
import {
  ISpecExplorer,
  ISpecStore,
  LoadOperationResult,
  LoadSchemaResult,
  SpecCatalogEntry,
  SpecOperationEntry,
  SpecSchemaEntry,
  SpecServiceConfig,
} from "./interfaces/ISpecService";
import { SyncConfig } from "./interfaces/ISyncManager";

/**
 * Custom error class for spec service related errors
 */
export class SpecServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INIT_ERROR"
      | "PERSIST_ERROR"
      | "LOAD_ERROR"
      | "SCAN_ERROR",
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "SpecServiceError";
  }
}

export class FileSystemSpecService implements ISpecStore, ISpecExplorer {
  private readonly config: Required<SpecServiceConfig>;
  private readonly logger: Logger;
  private readonly specCache: SimpleCache<string, OpenAPIV3.Document>;
  private readonly folderPath: string;
  private readonly catalogPath: string;
  private readonly dereferencedPath: string;
  private specs: { [specId: string]: OpenAPIV3.Document } = {};
  private catalog: SpecCatalogEntry[] = [];

  constructor(
    private readonly scanner: ISpecScanner,
    config: SpecServiceConfig,
    logger?: Logger
  ) {
    this.config = {
      basePath: config.basePath,
      catalogDir: config.catalogDir || "_catalog",
      dereferencedDir: config.dereferencedDir || "_dereferenced",
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 1000,
      cache: {
        maxSize: config.cache?.maxSize || 500,
        ttl: config.cache?.ttl || 60 * 60 * 1000, // 1 hour
      },
    };

    this.logger = logger || new ConsoleLogger();
    this.folderPath = this.config.basePath;
    this.catalogPath = path.join(this.folderPath, this.config.catalogDir);
    this.dereferencedPath = path.join(
      this.folderPath,
      this.config.dereferencedDir
    );

    this.specCache = new SimpleCache<string, OpenAPIV3.Document>({
      maxSize: this.config.cache.maxSize,
      ttl: this.config.cache.ttl,
    });
  }

  // Core Lifecycle Methods
  public async initialize() {
    try {
      await this.syncFromConfig();
      await this.ensureDirectories();
      await this.loadExistingCatalog();
      await this.scanAndSave(this.folderPath);
    } catch (error) {
      console.error("Failed to initialize spec service:", error);
      throw error;
    }
  }

  public async refresh(): Promise<void> {
    if (!this.folderPath) {
      throw new Error("FileSystemSpecService not initialized");
    }
    await this.initialize();
  }

  // Catalog Methods
  public async getApiCatalog(): Promise<SpecCatalogEntry[]> {
    return this.catalog;
  }

  public async saveSpecCatalog(catalog: SpecCatalogEntry[]): Promise<void> {
    if (!this.catalogPath) {
      throw new Error("FileSystemSpecService not initialized");
    }
    const catalogPath = path.join(this.catalogPath, "catalog.json");
    await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2));
  }

  public async loadSpecCatalog(): Promise<SpecCatalogEntry[]> {
    try {
      const catalogPath = path.join(this.catalogPath, "catalog.json");
      const catalog = await fs.readFile(catalogPath, "utf-8");
      return JSON.parse(catalog);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  public async scanAndSave(folderPath: string): Promise<void> {
    this.logger.debug({ folderPath }, "Starting scan and persist operation");
    const tempCatalog: SpecCatalogEntry[] = [];
    const pendingOperations: Array<{
      spec: OpenAPIV3.Document;
      entry: SpecCatalogEntry;
    }> = [];

    try {
      for await (const scanResult of this.scanner.scan(folderPath)) {
        const { filename, spec, specId, error } = scanResult;

        if (error) {
          this.logger.warn({ filename, error }, "Error scanning file");
          continue;
        }

        try {
          const operations: SpecOperationEntry[] = [];
          const schemas: SpecSchemaEntry[] = [];

          // Extract operations
          for (const path in spec.paths) {
            const pathItem = spec.paths[path];
            for (const method in pathItem) {
              if (method === "parameters" || method === "$ref") continue;
              const operation = pathItem[method] as OpenAPIV3.OperationObject;
              operations.push({
                path,
                method,
                description: operation.description,
                operationId: operation.operationId,
              });
            }
          }

          // Extract schemas
          if (spec.components?.schemas) {
            for (const [name, schema] of Object.entries(
              spec.components.schemas
            )) {
              schemas.push({
                name,
                description: (schema as OpenAPIV3.SchemaObject).description,
              });
            }
          }

          const entry: SpecCatalogEntry = {
            uri: {
              specId,
              type: "specification",
              identifier: specId,
            },
            description: spec.info.description,
            operations,
            schemas,
          };

          pendingOperations.push({ spec, entry });
        } catch (error) {
          this.logger.warn(
            { filename, error },
            "Error processing specification"
          );
        }
      }

      await this.ensureDirectories();

      await Promise.all(
        pendingOperations.map(async ({ spec, entry }) => {
          await this.saveSpec(spec, entry.uri.specId);
          tempCatalog.push(entry);
        })
      );

      await this.saveSpecCatalog(tempCatalog);
      this.catalog = tempCatalog;

      this.logger.info("Successfully completed scan and persist operation");
    } catch (error) {
      this.logger.error({ error }, "Failed to scan and persist specifications");
      throw new SpecServiceError(
        "Failed to scan and persist specifications",
        "SCAN_ERROR",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Spec Storage Methods
  public async saveSpec(
    spec: OpenAPIV3.Document,
    specId: string
  ): Promise<void> {
    this.logger.debug({ specId }, "Persisting specification");
    try {
      await this.ensureDirectory(this.dereferencedPath);
      const specPath = path.join(this.dereferencedPath, `${specId}.json`);
      await fs.writeFile(specPath, JSON.stringify(spec, null, 2));
      this.specs[specId] = spec;
      this.specCache.set(specId, spec);
      this.logger.info({ specId }, "Successfully persisted specification");
    } catch (error) {
      this.logger.error({ specId, error }, "Failed to persist specification");
      throw new SpecServiceError(
        `Failed to persist specification ${specId}`,
        "PERSIST_ERROR",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  public async loadSpec(specId: string): Promise<OpenAPIV3.Document> {
    this.logger.debug({ specId }, "Loading specification");

    const cached = this.specCache.get(specId);
    if (cached) {
      this.logger.debug({ specId }, "Returning cached specification");
      return cached;
    }

    try {
      const specPath = path.join(this.dereferencedPath, `${specId}.json`);
      const spec = JSON.parse(await fs.readFile(specPath, "utf-8"));
      this.specCache.set(specId, spec);
      this.logger.info({ specId }, "Successfully loaded specification");
      return spec;
    } catch (error) {
      this.logger.error({ specId, error }, "Failed to load specification");
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new SpecServiceError(
          `Specification not found: ${specId}`,
          "LOAD_ERROR"
        );
      }
      throw new SpecServiceError(
        `Failed to load specification ${specId}`,
        "LOAD_ERROR",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Search Methods
  public async searchOperations(
    query: string,
    specId?: string
  ): Promise<LoadOperationResult[]> {
    const targetSpecs: SpecCatalogEntry[] = [];
    if (specId) {
      const spec = this.catalog.find((spec) => spec.uri.specId === specId);
      if (spec) {
        targetSpecs.push(spec);
      }
    } else {
      targetSpecs.push(...this.catalog);
    }

    const results: LoadOperationResult[] = [];
    for (const spec of targetSpecs) {
      const specDoc = this.specs[spec.uri.specId];
      if (!specDoc?.paths) continue;

      for (const path in specDoc.paths) {
        const pathItem = specDoc.paths[path];
        if (!pathItem) continue;

        for (const method in pathItem) {
          if (method === "parameters" || method === "$ref") continue;
          const operation = pathItem[method] as OpenAPIV3.OperationObject;
          if (!operation) continue;

          const searchText = [
            operation.operationId,
            operation.summary,
            operation.description,
            ...(operation.tags || []),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          if (searchText.includes(query.toLowerCase())) {
            results.push({
              path,
              method,
              operation,
              specId: spec.uri.specId,
              uri: `apis://${spec.uri.specId}/operations/${operation.operationId}`,
            });
          }
        }
      }
    }

    return results;
  }

  public async searchSchemas(
    query: string,
    specId?: string
  ): Promise<SpecSchemaEntry[]> {
    const targetSpecs: SpecCatalogEntry[] = [];
    if (specId) {
      const spec = this.catalog.find((spec) => spec.uri.specId === specId);
      if (spec) {
        targetSpecs.push(spec);
      }
    } else {
      targetSpecs.push(...this.catalog);
    }

    const schemaEntries: SpecSchemaEntry[] = [];
    for (const spec of targetSpecs) {
      schemaEntries.push(
        ...spec.schemas.map((schema) => ({
          ...schema,
          specId: spec.uri.specId,
        }))
      );
    }

    const fuse = new Fuse(schemaEntries, {
      includeScore: true,
      threshold: 0.2,
      keys: ["name", "description"],
    });

    const results = fuse.search(query);
    return results.map((result) => result.item);
  }

  // Find Methods
  public async findSchemaByName(
    specId: string,
    schemaName: string
  ): Promise<LoadSchemaResult | null> {
    const spec = this.specs[specId];
    if (!spec) return null;

    const schema = spec.components?.schemas?.[schemaName];
    if (!schema) return null;

    return {
      name: schemaName,
      description: schema["description"],
      schema: schema as OpenAPIV3.SchemaObject,
      uri: `apis://${specId}/schemas/${schemaName}`,
    };
  }

  public async findOperationById(
    specId: string,
    operationId: string
  ): Promise<LoadOperationResult | null> {
    const spec = this.specs[specId];
    if (!spec) return null;

    for (const path in spec.paths) {
      const pathItem = spec.paths[path];
      for (const method in pathItem) {
        if (pathItem[method]["operationId"] === operationId) {
          return {
            path,
            method,
            operation: pathItem[method],
            specId,
            uri: `apis://${specId}/operations/${operationId}`,
          };
        }
      }
    }
    return null;
  }

  public async findOperationByPathAndMethod(
    specId: string,
    path: string,
    method: string
  ): Promise<LoadOperationResult | null> {
    const spec = this.specs[specId];
    if (!spec) return null;

    const pathItem = spec.paths[path];
    if (!pathItem) return null;

    const operation = pathItem[method];
    if (!operation) return null;

    return {
      path,
      method,
      operation,
      specId,
      uri: `apis://${specId}/operations/${operation.operationId}`,
    };
  }

  // Private Helper Methods
  private async ensureDirectory(dir: string) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      throw new SpecServiceError(
        `Failed to create directory ${dir}`,
        "INIT_ERROR",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private async ensureDirectories() {
    this.logger.debug("Ensuring required directories exist");
    await Promise.all([
      this.ensureDirectory(this.folderPath),
      this.ensureDirectory(this.catalogPath),
      this.ensureDirectory(this.dereferencedPath),
    ]);
  }

  private resetState() {
    this.logger.debug("Resetting service state");
    this.catalog = [];
    this.specs = {};
    this.specCache.clear();
  }

  private async loadExistingCatalog(): Promise<boolean> {
    try {
      this.logger.debug("Loading existing catalog");
      this.catalog = await this.loadSpecCatalog();
      const specs = await Promise.all(
        this.catalog.map((spec) => this.loadSpec(spec.uri.specId))
      );
      specs.forEach((spec, index) => {
        const specId = this.catalog[index].uri.specId;
        this.specs[specId] = spec;
        this.specCache.set(specId, spec);
      });
      this.logger.info("Successfully loaded existing catalog");
      return true;
    } catch (error) {
      this.logger.warn({ error }, "Failed to load existing catalog");
      this.resetState();
      return false;
    }
  }

  private async syncFromConfig(): Promise<void> {
    try {
      const configPath = path.join(this.folderPath, "reapi.config.json");
      let syncConfig: SyncConfig | undefined;

      try {
        const configContent = await fs.readFile(configPath, "utf-8");
        const config = JSON.parse(configContent);
        if (config.sources) {
          syncConfig = {
            sources: config.sources,
            targetDirectory: this.folderPath,
          };
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }

      if (syncConfig) {
        const syncManager = new SyncManager(this.folderPath);
        const results = await syncManager.sync(syncConfig);

        for (const result of results) {
          if (!result.success) {
            this.logger.error(
              `Failed to sync ${result.filename}: ${result.error?.message}`
            );
          } else {
            this.logger.info(`Successfully synced ${result.filename}`);
          }
        }
      }
    } catch (error) {
      this.logger.error("Failed to sync specs:", error);
      throw error;
    }
  }
}

/**
 * Persist OpenAPI specifications in a LanceDB
 * Use semantic search to query specifications
 * TODO: implement
 */
// export abstract class LanceDbSpecService
//   implements ISpecPersister, ISpecExplorer
// {
//   constructor() {}
// }
